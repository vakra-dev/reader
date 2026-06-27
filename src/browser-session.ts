/**
 * Browser Session
 *
 * Launches a Chrome instance directly and returns a CDP WebSocket URL.
 * For authenticated proxies, proxy-chain handles auth transparently
 * without breaking the TLS chain.
 *
 * Architecture:
 * - 1 Chrome process per session
 * - proxy-chain for authenticated proxy tunneling (no TLS breakage)
 * - Clean lifecycle: close = kill processes, done
 *
 * @example
 * ```typescript
 * const session = await createBrowserSession({ verbose: true });
 * const browser = await chromium.connectOverCDP(session.wsEndpoint);
 * const page = (await browser.newContext()).newPage();
 * await page.goto('https://example.com');
 * await session.close();
 * ```
 */

import { spawn } from "child_process";
import { createInterface } from "readline";
import { randomUUID } from "crypto";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { anonymizeProxy, closeAnonymizedProxy } from "proxy-chain";
import { FingerprintGenerator } from "fingerprint-generator";
import { FingerprintInjector } from "fingerprint-injector";
import { createProxyUrl } from "./proxy/config";
import { createLogger } from "./utils/logger";
import { findChromePath, buildChromeArgs, CHROME_LAUNCH_TIMEOUT_MS } from "./browser/shared";
import type { BrowserSession, BrowserSessionInternalOptions } from "./browser-types";

const logger = createLogger("browser-session");

const DEFAULT_SESSION_TIMEOUT_MS = 300_000; // 5 minutes

// ─── Main ────────────────────────────────────────────────────────────

/**
 * Create a browser session with a CDP WebSocket endpoint.
 *
 * Launches Chrome directly with remote debugging enabled. Each session
 * gets an isolated user-data-dir. For authenticated proxies, proxy-chain
 * handles auth transparently without breaking TLS.
 */
export async function createBrowserSession(
  options: BrowserSessionInternalOptions
): Promise<BrowserSession> {
  const sessionId = randomUUID();
  const timeoutMs = options.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
  const verbose = options.verbose ?? false;

  if (verbose) {
    logger.info(`Creating browser session ${sessionId}`);
  }

  // Resolve proxy from pool or explicit option
  const proxyConfig = options.proxy ?? options.resolveProxy?.(options.proxyTier);
  const proxyUrl = proxyConfig ? createProxyUrl(proxyConfig) : undefined;

  // proxy-chain handles auth transparently (no TLS breakage, no "Not Secure")
  let anonymizedUrl: string | undefined;
  let chromeProxyArg: string | undefined;

  if (proxyUrl) {
    anonymizedUrl = await anonymizeProxy(proxyUrl);
    chromeProxyArg = anonymizedUrl;
    if (verbose) {
      logger.info(
        `Proxy anonymized: ${proxyUrl.replace(/\/\/[^@]+@/, "//***@")} -> ${anonymizedUrl}`
      );
    }
  }

  // Generate fingerprint before launching Chrome so we can pass the UA
  // as --user-agent flag. Chrome uses this for all HTTP request headers,
  // which is what CF reads — no CDP connection scoping issues.
  let sessionFingerprint:
    | import("fingerprint-generator").BrowserFingerprintWithHeaders["fingerprint"]
    | null = null;
  try {
    const generator = new FingerprintGenerator();
    const result = generator.getFingerprint({
      browsers: [{ name: "chrome" as const, minVersion: 120 }],
      operatingSystems: [process.platform === "darwin" ? "macos" : "linux"],
    });
    sessionFingerprint = result.fingerprint;
  } catch (err) {
    logger.warn({ err }, `Session ${sessionId} fingerprint generation failed, continuing without`);
  }

  // Each session gets its own profile directory for isolation
  const userDataDir = mkdtempSync(join(tmpdir(), `reader-session-${sessionId}-`));

  // Build Chrome launch args — pass fingerprint UA so HTTP headers look real
  const chromePath = findChromePath();
  const args = buildChromeArgs({
    userDataDir,
    headless: !options.showChrome,
    proxyServer: chromeProxyArg,
    userAgent: sessionFingerprint?.navigator?.userAgent,
  });

  if (verbose) {
    logger.info(
      `Launching Chrome: ${chromePath} (${args.length} args, proxy: ${chromeProxyArg ?? "none"})`
    );
  }

  // Launch Chrome process
  const chromeProcess = spawn(chromePath, args, {
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  let closed = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  // Extract the WebSocket URL from Chrome's stderr
  let wsEndpoint: string;
  try {
    wsEndpoint = await new Promise<string>((resolve, reject) => {
      const launchTimeout = setTimeout(() => {
        reject(new Error("Timed out waiting for Chrome to start"));
      }, CHROME_LAUNCH_TIMEOUT_MS);

      if (chromeProcess.stderr) {
        const rl = createInterface({ input: chromeProcess.stderr });
        rl.on("line", (line) => {
          const match = line.match(/DevTools listening on (ws:\/\/\S+)/);
          if (match) {
            clearTimeout(launchTimeout);
            rl.close();
            resolve(match[1]);
          }
        });
      }

      chromeProcess.on("error", (err) => {
        clearTimeout(launchTimeout);
        reject(new Error(`Failed to launch Chrome: ${err.message}`));
      });

      chromeProcess.on("exit", (code) => {
        if (!closed) {
          clearTimeout(launchTimeout);
          reject(new Error(`Chrome exited with code ${code} before ready`));
        }
      });
    });
  } catch (error: unknown) {
    try {
      chromeProcess.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    if (anonymizedUrl) {
      await closeAnonymizedProxy(anonymizedUrl, true).catch(() => {});
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    throw new Error(`Failed to launch browser session: ${(error as Error).message}`);
  }

  if (verbose) {
    logger.info(`Session ${sessionId} ready: ${wsEndpoint}`);
  }

  // Pre-warm a fingerprinted context. We keep the internal Playwright
  // connection alive for the session lifetime -- Chrome scopes
  // Emulation.setUserAgentOverride to the CDP connection that set it, so
  // disconnecting would clear the UA override. Multiple CDP connections to
  // the same Chrome instance are fully supported.
  let internalPwBrowser: import("playwright-core").Browser | null = null;
  if (sessionFingerprint) {
    try {
      const { chromium } = await import("playwright-core");
      internalPwBrowser = await chromium.connectOverCDP(wsEndpoint);

      const context = await internalPwBrowser.newContext({
        userAgent: sessionFingerprint.navigator?.userAgent,
        viewport: sessionFingerprint.screen
          ? { width: sessionFingerprint.screen.width, height: sessionFingerprint.screen.height }
          : undefined,
        locale: sessionFingerprint.navigator?.language,
      });

      const injector = new FingerprintInjector();
      await injector.attachFingerprintToPlaywright(context, {
        fingerprint: sessionFingerprint,
        headers: {},
      });

      // Add explicit UA init script so navigator.userAgent matches the HTTP
      // header set by --user-agent. fingerprint-injector uses CDP-level
      // Emulation.setUserAgentOverride which is connection-scoped; this init
      // script fires via Page.addScriptToEvaluateOnNewDocument which persists
      // in Chrome regardless of which CDP connection drives the page.
      if (sessionFingerprint.navigator?.userAgent) {
        await context.addInitScript((ua) => {
          Object.defineProperty(navigator, "userAgent", { get: () => ua });
          Object.defineProperty(navigator, "appVersion", {
            get: () => ua.replace("Mozilla/", ""),
          });
        }, sessionFingerprint.navigator.userAgent);
      }

      // Remove __pwInitScripts marker that Playwright adds to every addInitScript() call.
      // Detectable by anti-bot systems before page scripts run.
      await context
        .addInitScript(() => {
          delete (window as unknown as Record<string, unknown>).__pwInitScripts;
        })
        .catch(() => {});

      // Open a blank page so the context is ready to use
      await context.newPage();

      if (verbose) {
        logger.info(
          `Session ${sessionId} fingerprint injected (UA: ${sessionFingerprint.navigator?.userAgent?.slice(0, 60)})`
        );
      }
    } catch (err) {
      logger.warn({ err }, `Session ${sessionId} fingerprint injection failed, continuing without`);
      internalPwBrowser = null;
    }
  }

  const createdAt = new Date().toISOString();

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;

    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }

    if (verbose) {
      logger.info(`Closing browser session ${sessionId}`);
    }

    // Kill Chrome process group
    try {
      if (chromeProcess.pid && !chromeProcess.killed) {
        if (process.platform !== "win32") {
          try {
            process.kill(-chromeProcess.pid, "SIGTERM");
          } catch {
            /* ignore */
          }
        } else {
          chromeProcess.kill("SIGTERM");
        }
      }
    } catch {
      /* ignore */
    }

    // Disconnect internal Playwright connection (holds fingerprint overrides)
    if (internalPwBrowser) {
      await internalPwBrowser.close().catch(() => {});
      internalPwBrowser = null;
    }

    // Stop proxy-chain anonymized proxy
    if (anonymizedUrl) {
      await closeAnonymizedProxy(anonymizedUrl, true).catch(() => {});
    }

    // Clean up temp profile directory (delayed so Chrome can release locks)
    setTimeout(() => {
      try {
        rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }, 1000);
  };

  // Auto-close on timeout
  timeoutHandle = setTimeout(() => {
    if (verbose) {
      logger.info(`Session ${sessionId} timed out after ${timeoutMs}ms`);
    }
    close().catch(() => {});
  }, timeoutMs);

  if (timeoutHandle && typeof timeoutHandle === "object" && "unref" in timeoutHandle) {
    timeoutHandle.unref();
  }

  // Clean up if Chrome crashes
  chromeProcess.on("exit", () => {
    if (!closed) {
      close().catch(() => {});
    }
  });

  return {
    sessionId,
    wsEndpoint,
    createdAt,
    close,
  };
}
