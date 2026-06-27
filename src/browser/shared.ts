/**
 * Shared browser utilities for PlaywrightPool and browser sessions.
 *
 * Extracts common Chrome path resolution, proxy parsing, Chrome launch args,
 * and block detection patterns that were previously duplicated across
 * playwright-pool.ts and browser-session.ts.
 */

import { accessSync } from "fs";
import { createRequire } from "module";

// ─── Chrome path resolution ────────────────────────────────────────

export function findChromePath(): string {
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

// ─── Proxy parsing ────────────────────────────────────────────────

export function parseProxy(proxyUrl: string): {
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

// ─── Chrome launch args ───────────────────────────────────────────

export interface ChromeArgsOptions {
  userDataDir: string;
  headless: boolean;
  proxyServer?: string;
  userAgent?: string;
}

/**
 * Build Chrome launch arguments. Comprehensive flag set derived from
 * Steel Browser's production configuration + Reader's existing args.
 *
 * Key differences from previous args:
 * - No --ignore-certificate-errors (proxy-chain preserves TLS)
 * - --headless=new based on boolean only (no DISPLAY check)
 * - Expanded --disable-features matching Steel's proven set
 */
export function buildChromeArgs(opts: ChromeArgsOptions): string[] {
  const args = [
    "--remote-debugging-port=0",
    `--user-data-dir=${opts.userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--use-mock-keychain",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    // Disable features that leak automation signals or waste resources
    "--disable-features=MediaRouter,TranslateUI,IsolateOrigins,site-per-process,InterestFeedContentSuggestions,PrivacySandboxSettings4,AutofillServerCommunication,OptimizationHints,DialMediaRouteProvider,CertificateTransparencyComponentUpdater,GlobalMediaControls,AudioServiceOutOfProcess",
    "--disable-blink-features=AutomationControlled",
    // Reduce background activity
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--disable-translate",
    "--disable-client-side-phishing-detection",
    "--disable-component-update",
    "--disable-popup-blocking",
    "--disable-prompt-on-repost",
    "--disable-domain-reliability",
    "--disable-ipc-flooding-protection",
    "--disable-hang-monitor",
    "--disable-breakpad",
    "--disable-session-crashed-bubble",
    "--metrics-recording-only",
    "--no-pings",
    "--mute-audio",
    "--disable-backing-store-limit",
    // WebRTC: prevent IP leaking through WebRTC
    "--webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--force-webrtc-ip-handling-policy",
  ];

  if (opts.headless) {
    args.push("--headless=new");
  }

  if (opts.proxyServer) {
    args.push(`--proxy-server=${opts.proxyServer}`);
    args.push("--proxy-bypass-list=<-loopback>");
  }

  if (opts.userAgent) {
    args.push(`--user-agent=${opts.userAgent}`);
  }

  args.push("about:blank");
  return args;
}

export const CHROME_LAUNCH_TIMEOUT_MS = 15_000;
