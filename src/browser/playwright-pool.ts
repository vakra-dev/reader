/**
 * PlaywrightPool — Chrome process management with Playwright CDP connections.
 *
 * Replaces HeroCore + TieredBrowserPool + ProxyBoundBrowser for scraping.
 * Each proxy URL gets its own Chrome process, launched directly via
 * child_process.spawn (same pattern as browser-session.ts). Playwright
 * connects via CDP to drive pages.
 *
 * Architecture:
 *   - 1 proxy URL = 1 Chrome process = 1 Playwright Browser connection
 *   - Pages (tabs) are the unit of work, gated by pLimit(maxTabs)
 *   - Chrome is recycled after N pages to prevent memory leaks
 *   - No MITM proxy — Playwright uses CDP for load detection
 *   - Auth proxies use the same local forwarder as browser-session.ts
 *
 * For authenticated proxies, a local proxy forwarder is started per Chrome
 * instance. Chrome connects to localhost:PORT (no auth), the forwarder
 * adds credentials and tunnels to the upstream proxy.
 */

import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import { createServer, type Server } from "http";
import net from "net";
import { mkdtempSync, rmSync, accessSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createRequire } from "module";
import pLimit from "p-limit";
import { createLogger, type Logger } from "../utils/logger.js";
import type { ProxyHealthTracker } from "../proxy/health-tracker.js";

// Lazy-loaded Playwright types — we import dynamically to avoid hard dep at parse time.
type PlaywrightBrowser = import("playwright-core").Browser;
type PlaywrightBrowserContext = import("playwright-core").BrowserContext;
type PlaywrightPage = import("playwright-core").Page;

const CHROME_LAUNCH_TIMEOUT_MS = 15_000;

// ─── Chrome path resolution ────────────────────────────────────────

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

// ─── Auth proxy forwarder (reused from browser-session.ts) ─────────

function startAuthProxy(
  upstreamHost: string,
  upstreamPort: number,
  username: string,
  password: string
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

    const server = createServer((req, res) => {
      const upstream = net.createConnection(upstreamPort, upstreamHost, () => {
        const reqLine = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
        let headers = "";
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          headers += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
        }
        headers += `Proxy-Authorization: ${authHeader}\r\n`;
        upstream.write(reqLine + headers + "\r\n");
        req.on("error", () => upstream.destroy());
        upstream.on("error", () => res.destroy());
        req.pipe(upstream);
        upstream.pipe(res);
      });
      upstream.on("error", () => res.destroy());
    });

    server.on("connect", (req, clientSocket, head) => {
      const upstream = net.createConnection(upstreamPort, upstreamHost, () => {
        upstream.write(
          `CONNECT ${req.url} HTTP/1.1\r\n` +
            `Host: ${req.url}\r\n` +
            `Proxy-Authorization: ${authHeader}\r\n` +
            `\r\n`
        );

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
            clientSocket.on("error", () => upstream.destroy());
            upstream.on("error", () => clientSocket.destroy());
            clientSocket.pipe(upstream);
            upstream.pipe(clientSocket);
          } else {
            clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
            clientSocket.destroy();
            upstream.destroy();
          }
        };
        upstream.on("data", onData);
      });

      clientSocket.on("error", () => upstream.destroy());
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

// ─── Types ─────────────────────────────────────────────────────────

export type PoolTier = "datacenter" | "residential" | "direct";

export interface PlaywrightPoolOptions {
  tiers: PlaywrightTierConfig[];
  maxTabsPerBrowser?: number;
  retireAfterPages?: number;
  /** Show Chrome browser window instead of headless. */
  showChrome?: boolean;
  /** Custom user agent string applied to every browser context. */
  userAgent?: string;
  /** ProxyHealthTracker for bench/revive event integration. */
  healthTracker?: ProxyHealthTracker;
  logger?: Logger;
}

export interface PlaywrightTierConfig {
  tier: PoolTier;
  proxyUrls: Array<string | null>;
}

export interface BrowserLease {
  browser: ChromeInstance;
  tier: PoolTier;
}

export interface ChromeInstanceStats {
  proxyUrl: string | null;
  state: "launching" | "active" | "retired" | "closed";
  activeTabs: number;
  totalPages: number;
}

export interface PoolStatsSnapshot {
  tiers: Array<{
    tier: PoolTier;
    browsers: ChromeInstanceStats[];
  }>;
}

// ─── ChromeInstance ─────────────────────────────────────────────────

/**
 * A single Chrome process bound to one proxy URL, with Playwright connected
 * via CDP. Equivalent to ProxyBoundBrowser but without Hero.
 */
export class ChromeInstance {
  readonly proxyUrl: string | null;
  readonly maxTabs: number;
  readonly retireAfterPages: number;

  private state: "launching" | "active" | "retired" | "closed" = "launching";
  private totalPages = 0;
  private recycling = false;
  private readonly limit: ReturnType<typeof pLimit>;
  private readonly logger: Logger;
  private readonly showChrome: boolean;
  private readonly userAgent: string | undefined;

  private chromeProcess: ChildProcess | null = null;
  private pwBrowser: PlaywrightBrowser | null = null;
  private pwContext: PlaywrightBrowserContext | null = null;
  private authProxyServer: Server | null = null;
  private userDataDir: string | null = null;
  private wsEndpoint: string | null = null;

  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: Error) => void;

  constructor(options: {
    proxyUrl: string | null;
    maxTabs?: number;
    retireAfterPages?: number;
    showChrome?: boolean;
    userAgent?: string;
    logger?: Logger;
  }) {
    this.proxyUrl = options.proxyUrl;
    this.maxTabs = options.maxTabs ?? 2;
    this.retireAfterPages = options.retireAfterPages ?? 100;
    this.showChrome = options.showChrome ?? false;
    this.userAgent = options.userAgent;
    this.logger = options.logger ?? createLogger("chrome-instance");

    this.limit = pLimit(this.maxTabs);

    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    void this.launch();
  }

  getState(): "launching" | "active" | "retired" | "closed" {
    return this.state;
  }

  isAvailable(): boolean {
    return this.state === "active";
  }

  getActiveTabs(): number {
    return this.limit.activeCount;
  }

  getStats(): ChromeInstanceStats {
    return {
      proxyUrl: this.proxyUrl,
      state: this.state,
      activeTabs: this.limit.activeCount,
      totalPages: this.totalPages,
    };
  }

  /**
   * Execute fn with a fresh Playwright Page. Acquires an internal tab slot;
   * at most maxTabs calls run concurrently.
   */
  async withPage<T>(fn: (page: PlaywrightPage) => Promise<T>): Promise<T> {
    if (this.state === "closed" || this.state === "retired") {
      throw new Error(`ChromeInstance: cannot withPage on ${this.state} browser`);
    }

    await this.ready;

    if (this.state !== "active") {
      throw new Error(`ChromeInstance: browser became ${this.state} before withPage could run`);
    }

    return this.limit(async () => {
      if (this.state !== "active" || !this.pwContext) {
        throw new Error("ChromeInstance: browser became unavailable while waiting for tab slot");
      }

      const page = await this.pwContext.newPage();

      try {
        return await fn(page);
      } finally {
        try {
          await page.close();
        } catch {
          /* swallow */
        }
        this.totalPages += 1;

        if (
          this.state === "active" &&
          !this.recycling &&
          this.totalPages >= this.retireAfterPages
        ) {
          this.recycling = true;
          setImmediate(() => {
            void this.relaunch()
              .catch((err) => {
                this.logger.error({ err, proxy: redactProxy(this.proxyUrl) }, "recycle failed");
              })
              .finally(() => {
                this.recycling = false;
              });
          });
        }
      }
    });
  }

  /**
   * Gracefully drain and close the Chrome process.
   */
  async retire(): Promise<void> {
    if (this.state === "closed") return;
    if (this.state === "retired") return;
    this.state = "retired";

    // Drain in-flight pages
    await this.drainLimit();
    await this.cleanup();
    this.state = "closed";
  }

  /**
   * Retire and relaunch with the same proxy.
   */
  async relaunch(): Promise<void> {
    if (this.state !== "closed") {
      await this.retire();
    }

    this.state = "launching";
    this.totalPages = 0;

    (this as { ready: Promise<void> }).ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    void this.launch();
    await this.ready;
  }

  private async launch(): Promise<void> {
    try {
      this.logger.debug({ proxy: redactProxy(this.proxyUrl) }, "launching Chrome");

      // Set up proxy forwarder if needed
      let chromeProxyArg: string | undefined;

      if (this.proxyUrl) {
        const parsed = parseProxy(this.proxyUrl);
        if (parsed.hasAuth) {
          const { server, port } = await startAuthProxy(
            parsed.host,
            parsed.port,
            parsed.username!,
            parsed.password!
          );
          this.authProxyServer = server;
          chromeProxyArg = `http://127.0.0.1:${port}`;
        } else {
          chromeProxyArg = this.proxyUrl;
        }
      }

      // Each instance gets its own profile directory
      this.userDataDir = mkdtempSync(join(tmpdir(), "reader-pw-"));

      const chromePath = findChromePath();
      const args = [
        "--remote-debugging-port=0",
        `--user-data-dir=${this.userDataDir}`,
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
        // Always accept certs — sites behind proxies, self-signed internal
        // sites, and misconfigured TLS should not block scraping.
        "--ignore-certificate-errors",
      ];

      if (!this.showChrome) {
        args.push("--headless=new");
      }

      if (chromeProxyArg) {
        args.push(`--proxy-server=${chromeProxyArg}`);
        args.push("--proxy-bypass-list=<-loopback>");
      }

      args.push("about:blank");

      this.chromeProcess = spawn(chromePath, args, {
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Extract WebSocket URL from Chrome stderr
      this.wsEndpoint = await new Promise<string>((resolve, reject) => {
        const launchTimeout = setTimeout(() => {
          reject(new Error("Timed out waiting for Chrome to start"));
        }, CHROME_LAUNCH_TIMEOUT_MS);

        if (this.chromeProcess!.stderr) {
          const rl = createInterface({ input: this.chromeProcess!.stderr });
          rl.on("line", (line) => {
            const match = line.match(/DevTools listening on (ws:\/\/\S+)/);
            if (match) {
              clearTimeout(launchTimeout);
              rl.close();
              resolve(match[1]);
            }
          });
        }

        this.chromeProcess!.on("error", (err) => {
          clearTimeout(launchTimeout);
          reject(new Error(`Failed to launch Chrome: ${err.message}`));
        });

        this.chromeProcess!.on("exit", (code) => {
          clearTimeout(launchTimeout);
          reject(new Error(`Chrome exited with code ${code} before ready`));
        });
      });

      // Connect Playwright via CDP with stealth plugin to avoid bot detection.
      // playwright-extra + puppeteer-extra-plugin-stealth patches navigator.webdriver,
      // chrome.runtime, plugins, languages, WebGL, and other automation signals.
      const { chromium } = await import("playwright-extra");
      const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
      chromium.use(StealthPlugin());
      this.pwBrowser = await chromium.connectOverCDP(this.wsEndpoint);

      // Use the default context or create one with custom userAgent
      const contexts = this.pwBrowser.contexts();
      if (this.userAgent) {
        // When a custom UA is set, create a fresh context with it.
        // Close the default context's pages to avoid leaks.
        if (contexts.length > 0) {
          for (const page of contexts[0].pages()) {
            await page.close().catch(() => {});
          }
        }
        this.pwContext = await this.pwBrowser.newContext({ userAgent: this.userAgent });
      } else if (contexts.length > 0) {
        this.pwContext = contexts[0];
      } else {
        this.pwContext = await this.pwBrowser.newContext();
      }

      // Handle Chrome crashes
      this.chromeProcess!.on("exit", () => {
        if (this.state === "active") {
          this.logger.warn({ proxy: redactProxy(this.proxyUrl) }, "Chrome process crashed");
          this.state = "closed";
          this.pwBrowser = null;
          this.pwContext = null;
        }
      });

      this.state = "active";
      this.resolveReady();

      this.logger.debug(
        { proxy: redactProxy(this.proxyUrl), ws: this.wsEndpoint },
        "Chrome ready via Playwright CDP"
      );
    } catch (err) {
      this.state = "closed";
      await this.cleanup();
      this.logger.error({ err, proxy: redactProxy(this.proxyUrl) }, "Chrome launch failed");
      this.rejectReady(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async cleanup(): Promise<void> {
    // Disconnect Playwright
    if (this.pwBrowser) {
      try {
        await this.pwBrowser.close();
      } catch {
        /* swallow */
      }
      this.pwBrowser = null;
      this.pwContext = null;
    }

    // Kill Chrome
    if (this.chromeProcess?.pid && !this.chromeProcess.killed) {
      try {
        if (process.platform !== "win32") {
          process.kill(-this.chromeProcess.pid, "SIGTERM");
        } else {
          this.chromeProcess.kill("SIGTERM");
        }
      } catch {
        /* swallow */
      }
      this.chromeProcess = null;
    }

    // Stop auth proxy
    if (this.authProxyServer) {
      this.authProxyServer.close();
      this.authProxyServer = null;
    }

    // Remove temp profile
    if (this.userDataDir) {
      setTimeout(() => {
        try {
          rmSync(this.userDataDir!, { recursive: true, force: true });
        } catch {
          /* swallow */
        }
      }, 1000);
      this.userDataDir = null;
    }
  }

  private async drainLimit(): Promise<void> {
    while (this.limit.activeCount > 0 || this.limit.pendingCount > 0) {
      await new Promise((r) => setImmediate(r));
    }
  }
}

// ─── PlaywrightPool ────────────────────────────────────────────────

/**
 * Top-level pool managing ChromeInstances grouped by tier.
 * Drop-in replacement for TieredBrowserPool.
 */
export class PlaywrightPool {
  private readonly tiers = new Map<PoolTier, Map<string, ChromeInstance>>();
  private readonly proxyToTier = new Map<string, PoolTier>();
  private readonly healthTracker?: ProxyHealthTracker;
  private readonly logger: Logger;
  private closed = false;

  readonly ready: Promise<void>;

  constructor(options: PlaywrightPoolOptions) {
    this.logger = options.logger ?? createLogger("playwright-pool");
    this.healthTracker = options.healthTracker;

    const readyPromises: Promise<unknown>[] = [];

    for (const tierConfig of options.tiers) {
      const map = new Map<string, ChromeInstance>();
      let directIndex = 0;
      for (const proxyUrl of tierConfig.proxyUrls) {
        // Direct instances (null proxyUrl) need unique keys since there
        // can be multiple. Use "direct:0", "direct:1", etc.
        const key = proxyUrl ?? `direct:${directIndex++}`;
        if (map.has(key)) {
          this.logger.warn(
            { proxy: redactProxy(proxyUrl), tier: tierConfig.tier },
            "duplicate proxy URL in tier; skipping"
          );
          continue;
        }
        const instance = new ChromeInstance({
          proxyUrl,
          maxTabs: options.maxTabsPerBrowser ?? 2,
          retireAfterPages: options.retireAfterPages ?? 100,
          showChrome: options.showChrome,
          userAgent: options.userAgent,
          logger: this.logger,
        });
        map.set(key, instance);
        this.proxyToTier.set(key, tierConfig.tier);

        readyPromises.push(
          instance.ready.catch((err) => {
            this.logger.error(
              { err, proxy: redactProxy(proxyUrl), tier: tierConfig.tier },
              "Chrome failed to launch during pool startup"
            );
          })
        );
      }
      this.tiers.set(tierConfig.tier, map);
    }

    this.ready = Promise.all(readyPromises).then(() => undefined);

    // Subscribe to health events if a tracker was provided.
    if (this.healthTracker) {
      this.attachHealthListeners(this.healthTracker);
    }
  }

  /**
   * Acquire the least-loaded healthy Chrome instance from a tier.
   */
  acquire(tier: PoolTier): BrowserLease {
    if (this.closed) {
      throw new Error("PlaywrightPool: pool is closed");
    }
    const map = this.tiers.get(tier);
    if (!map || map.size === 0) {
      throw new Error(`PlaywrightPool: no browsers configured for tier "${tier}"`);
    }

    let best: ChromeInstance | null = null;
    let bestLoad = Infinity;

    for (const instance of map.values()) {
      if (!instance.isAvailable()) continue;
      // If we have a health tracker, skip unhealthy proxies
      if (
        this.healthTracker &&
        instance.proxyUrl &&
        !this.healthTracker.isHealthy(instance.proxyUrl)
      ) {
        continue;
      }
      const load = instance.getActiveTabs();
      if (load < bestLoad) {
        best = instance;
        bestLoad = load;
      }
    }

    if (!best) {
      throw new Error(
        `PlaywrightPool: no available browsers in tier "${tier}" (all launching, retired, or closed)`
      );
    }

    return { browser: best, tier };
  }

  hasTier(tier: PoolTier): boolean {
    const map = this.tiers.get(tier);
    return !!map && map.size > 0;
  }

  getBrowserByProxy(proxyUrl: string | null): ChromeInstance | null {
    // For proxied lookups, search by proxy URL across all tiers
    if (proxyUrl) {
      for (const map of this.tiers.values()) {
        for (const instance of map.values()) {
          if (instance.proxyUrl === proxyUrl) return instance;
        }
      }
      return null;
    }
    // For direct (null proxy), return the first available direct instance
    const directMap = this.tiers.get("direct");
    if (!directMap) return null;
    for (const instance of directMap.values()) {
      if (instance.isAvailable()) return instance;
    }
    // Return any direct instance even if not available (caller checks)
    return directMap.values().next().value ?? null;
  }

  getStats(): PoolStatsSnapshot {
    const tiers: PoolStatsSnapshot["tiers"] = [];
    for (const [tier, map] of this.tiers.entries()) {
      const browsers: ChromeInstanceStats[] = [];
      for (const instance of map.values()) {
        browsers.push(instance.getStats());
      }
      tiers.push({ tier, browsers });
    }
    return { tiers };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const retirements: Promise<void>[] = [];
    for (const map of this.tiers.values()) {
      for (const instance of map.values()) {
        retirements.push(instance.retire().catch(() => undefined));
      }
    }
    await Promise.all(retirements);
  }

  /**
   * Wire up event listeners on the ProxyHealthTracker so the pool reacts
   * to runtime bench/revive signals:
   *
   *   proxy-benched  -> retire the corresponding browser
   *   proxy-revived  -> relaunch the corresponding browser
   */
  private attachHealthListeners(tracker: ProxyHealthTracker): void {
    tracker.on("proxy-benched", ({ proxyUrl }) => {
      const browser = this.getBrowserByProxy(proxyUrl);
      if (!browser) return;
      this.logger.warn({ proxy: redactProxy(proxyUrl) }, "proxy benched, retiring browser");
      void browser.retire().catch((err) => {
        this.logger.error(
          { err, proxy: redactProxy(proxyUrl) },
          "failed to retire benched browser"
        );
      });
    });

    tracker.on("proxy-revived", ({ proxyUrl }) => {
      const browser = this.getBrowserByProxy(proxyUrl);
      if (!browser) return;
      this.logger.info({ proxy: redactProxy(proxyUrl) }, "proxy revived, relaunching browser");
      void browser.relaunch().catch((err) => {
        this.logger.error(
          { err, proxy: redactProxy(proxyUrl) },
          "failed to relaunch revived browser"
        );
      });
    });
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Redact proxy URL for logging. Same as proxy-bound-browser.ts.
 */
function redactProxy(proxyUrl: string | null): string {
  if (!proxyUrl) return "direct";
  try {
    const u = new URL(proxyUrl);
    const creds = u.username ? "***@" : "";
    return `${u.protocol}//${creds}${u.host}`;
  } catch {
    return "<invalid-proxy-url>";
  }
}

/**
 * Build PlaywrightPool tier configs from ProxyPoolConfig.
 * Same logic as buildTierConfigsFromPools in tiered-pool.ts.
 */
export function buildPlaywrightTierConfigs(
  pools:
    | {
        datacenter?: Array<{ url?: string }>;
        residential?: Array<{ url?: string }>;
      }
    | undefined,
  opts: { directPoolSize?: number } = {}
): PlaywrightTierConfig[] {
  const directSize = opts.directPoolSize ?? 1;

  function extractUrls(list: Array<{ url?: string }> | undefined): string[] {
    return (list ?? []).map((p) => p.url ?? "").filter((u) => u.length > 0);
  }

  const dcUrls = extractUrls(pools?.datacenter);
  const resUrls = extractUrls(pools?.residential);

  const tiers: PlaywrightTierConfig[] = [];

  if (dcUrls.length > 0 || resUrls.length > 0) {
    if (dcUrls.length > 0) {
      tiers.push({ tier: "datacenter", proxyUrls: dcUrls });
    }
    if (resUrls.length > 0) {
      tiers.push({ tier: "residential", proxyUrls: resUrls });
    }
  } else {
    const directUrls: Array<string | null> = Array.from({ length: directSize }, () => null);
    tiers.push({ tier: "direct", proxyUrls: directUrls });
  }

  return tiers;
}
