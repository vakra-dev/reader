/**
 * Browser Session
 *
 * Launches a Chrome instance directly and returns a CDP WebSocket URL.
 * No Hero involvement — Chrome is the product, not Hero.
 *
 * For authenticated proxies, a lightweight local proxy forwarder is
 * started per session. Chrome connects to `localhost:PORT` (no auth),
 * the forwarder adds credentials and forwards to the upstream proxy.
 *
 * Architecture at scale:
 * - 1 Chrome process per session
 * - 1 local proxy forwarder per session (if proxy has auth)
 * - No Hero overhead
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
import { createServer, type Server } from "http";
import net from "net";
import { randomUUID } from "crypto";
import { mkdtempSync, rmSync, accessSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createRequire } from "module";
import { createProxyUrl } from "./proxy/config";
import { createLogger } from "./utils/logger";
import type { BrowserSession, BrowserSessionInternalOptions } from "./browser-types";

const logger = createLogger("browser-session");

const DEFAULT_SESSION_TIMEOUT_MS = 300_000; // 5 minutes
const CHROME_LAUNCH_TIMEOUT_MS = 15_000;

/**
 * Find the Chrome executable path.
 * Priority: CHROME_139_BIN env var → Hero's bundled Chrome → system Chrome.
 */
function findChromePath(): string {
  if (process.env.CHROME_139_BIN) {
    return process.env.CHROME_139_BIN;
  }

  try {
    const req = createRequire(import.meta.url);
    const ChromeEngine = req("@ulixee/chrome-139-0");
    const chrome = new ChromeEngine();
    if (chrome.executablePath) return chrome.executablePath;
  } catch {
    // Not available
  }

  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  if (process.platform === "linux") {
    for (const p of [
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
    ]) {
      try {
        accessSync(p);
        return p;
      } catch {
        /* continue */
      }
    }
  }
  return "google-chrome";
}

// ─── Local Auth Proxy Forwarder ──────────────────────────────────────

/**
 * Start a lightweight local HTTP CONNECT proxy that adds auth to an
 * upstream proxy. Chrome connects to localhost:PORT (no auth needed),
 * the forwarder adds Proxy-Authorization and forwards to the real proxy.
 *
 * Handles both CONNECT (HTTPS tunneling) and plain HTTP requests.
 */
function startAuthProxy(
  upstreamHost: string,
  upstreamPort: number,
  username: string,
  password: string
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

    const server = createServer((req, res) => {
      // Plain HTTP proxy (non-CONNECT)
      const upstream = net.createConnection(upstreamPort, upstreamHost, () => {
        const reqLine = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
        let headers = "";
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          headers += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
        }
        headers += `Proxy-Authorization: ${authHeader}\r\n`;
        upstream.write(reqLine + headers + "\r\n");
        req.pipe(upstream);
        upstream.pipe(res);
      });
      upstream.on("error", () => res.destroy());
    });

    // CONNECT method (HTTPS tunneling)
    server.on("connect", (req, clientSocket, head) => {
      const upstream = net.createConnection(upstreamPort, upstreamHost, () => {
        // Send CONNECT to upstream with auth
        upstream.write(
          `CONNECT ${req.url} HTTP/1.1\r\n` +
            `Host: ${req.url}\r\n` +
            `Proxy-Authorization: ${authHeader}\r\n` +
            `\r\n`
        );

        // Wait for upstream's 200 response
        let buf = Buffer.alloc(0);
        const onData = (chunk: Buffer) => {
          buf = Buffer.concat([buf, chunk]);
          const headerEnd = buf.indexOf("\r\n\r\n");
          if (headerEnd === -1) return;

          upstream.removeListener("data", onData);

          const statusLine = buf.subarray(0, buf.indexOf("\r\n")).toString();
          const remaining = buf.subarray(headerEnd + 4);

          if (statusLine.includes("200")) {
            clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            if (remaining.length > 0) clientSocket.write(remaining);
            if (head.length > 0) upstream.write(head);
            clientSocket.pipe(upstream);
            upstream.pipe(clientSocket);
          } else {
            clientSocket.write(`HTTP/1.1 502 Bad Gateway\r\n\r\n`);
            clientSocket.destroy();
            upstream.destroy();
          }
        };
        upstream.on("data", onData);
      });

      upstream.on("error", () => {
        clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        clientSocket.destroy();
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to start auth proxy"));
        return;
      }
      resolve({ server, port: addr.port });
    });

    server.on("error", reject);
  });
}

/**
 * Parse a proxy URL into components.
 * Returns { host, port, username?, password?, hasAuth }
 */
function parseProxy(proxyUrl: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  hasAuth: boolean;
} {
  const url = new URL(proxyUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port, 10),
    username: url.username || undefined,
    password: url.password || undefined,
    hasAuth: !!url.username,
  };
}

// ─── Main ────────────────────────────────────────────────────────────

/**
 * Create a browser session with a CDP WebSocket endpoint.
 *
 * Launches Chrome directly with remote debugging enabled. Each session
 * gets an isolated user-data-dir. For authenticated proxies, a local
 * proxy forwarder is started to handle auth transparently.
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

  // If proxy has auth, start a local forwarder
  let authProxyServer: Server | undefined;
  let chromeProxyArg: string | undefined;

  if (proxyUrl) {
    const parsed = parseProxy(proxyUrl);
    if (parsed.hasAuth) {
      // Start local auth proxy forwarder
      const { server, port } = await startAuthProxy(
        parsed.host,
        parsed.port,
        parsed.username!,
        parsed.password!
      );
      authProxyServer = server;
      chromeProxyArg = `http://127.0.0.1:${port}`;
      if (verbose) {
        logger.info(`Auth proxy forwarder on :${port} → ${parsed.host}:${parsed.port}`);
      }
    } else {
      // No auth needed, pass directly
      chromeProxyArg = proxyUrl;
    }
  }

  // Each session gets its own profile directory for isolation
  const userDataDir = mkdtempSync(join(tmpdir(), `reader-session-${sessionId}-`));

  // Build Chrome launch args
  const chromePath = findChromePath();
  const args = [
    `--remote-debugging-port=0`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--use-mock-keychain",
    "--disable-features=MediaRouter",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--disable-translate",
    "--metrics-recording-only",
    "--mute-audio",
    "--disable-blink-features=AutomationControlled",
  ];

  const hasDisplay = !!process.env.DISPLAY;
  if (!options.showChrome && !hasDisplay) {
    args.push("--headless=new");
  }

  if (chromeProxyArg) {
    args.push(`--proxy-server=${chromeProxyArg}`);
    args.push("--proxy-bypass-list=<-loopback>");
    // Accept self-signed certs from the proxy forwarder
    args.push("--ignore-certificate-errors");
  }

  // Open about:blank so there's a page ready for the user
  args.push("about:blank");

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
    authProxyServer?.close();
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

    // Stop the auth proxy forwarder
    authProxyServer?.close();

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
