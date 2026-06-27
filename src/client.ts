/**
 * ReaderClient
 *
 * A client wrapper that manages browser pool lifecycle and provides
 * a simple interface for scraping and crawling.
 *
 * Uses Playwright + direct Chrome spawn (no Hero, no MITM) for scraping.
 * Browser sessions also use direct Chrome spawn (unchanged).
 *
 * @example
 * const reader = new ReaderClient();
 *
 * const result = await reader.scrape({
 *   urls: ['https://example.com'],
 *   formats: ['markdown'],
 * });
 *
 * console.log(result.data[0].markdown);
 *
 * // When done (optional - auto-closes on process exit)
 * await reader.close();
 */

import { scrape } from "./scraper";
import { crawl } from "./crawler";
import { createBrowserSession } from "./browser-session";
import type { BrowserOptions, BrowserSession } from "./browser-types";
import { PlaywrightPool, buildPlaywrightTierConfigs } from "./browser/playwright-pool";
import { PerProxyGate } from "./proxy/proxy-gate";
import { ProxyHealthTracker } from "./proxy/health-tracker";
import type {
  ScrapeOptions,
  ScrapeResult,
  ProxyConfig,
  ProxyPoolConfig,
  BrowserPoolConfig,
  ProxyTier,
} from "./types";
import type { CrawlOptions, CrawlResult } from "./crawl-types";
import { createLogger } from "./utils/logger";

const logger = createLogger("client");

/**
 * Proxy rotation strategy
 */
export type ProxyRotation = "round-robin" | "random";

/**
 * Configuration options for ReaderClient
 */
export interface ReaderClientOptions {
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
  /** Show Chrome browser window (default: false) */
  showChrome?: boolean;

  /** Browser pool configuration */
  browserPool?: BrowserPoolConfig;

  /** List of proxies to rotate through (legacy — use proxyPools for tier-based) */
  proxies?: ProxyConfig[];

  /**
   * Multi-tier proxy pools.
   * When configured, proxy selection is based on the `proxyTier` option per-request.
   *
   * @example
   * proxyPools: {
   *   standard: [{ url: "http://dc-proxy:port" }],
   *   premium: [{ url: "http://res-proxy:port" }],
   * }
   */
  proxyPools?: ProxyPoolConfig;

  /** Proxy rotation strategy (default: "round-robin") */
  proxyRotation?: ProxyRotation;

  /**
   * Custom user agent string. Applied to all browsers in the pool.
   *
   * WARNING: Overriding the default UA can cause TLS/UA mismatches
   * detected by anti-bot systems.
   */
  userAgent?: string;

  /** Skip TLS/SSL certificate verification (default: true) */
  skipTLSVerification?: boolean;
}

/**
 * ReaderClient manages the browser pool lifecycle and provides
 * scrape/crawl methods with automatic initialization.
 */
export class ReaderClient {
  private pool: PlaywrightPool | null = null;
  private proxyGate: PerProxyGate | null = null;
  private healthTracker: ProxyHealthTracker | null = null;
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private closed = false;
  private options: ReaderClientOptions;
  private proxyIndex = 0;
  private cleanupHandler: (() => Promise<void>) | null = null;
  private activeSessions = new Map<string, BrowserSession>();

  constructor(options: ReaderClientOptions = {}) {
    this.options = options;

    // Register cleanup on process exit
    this.registerCleanup();
  }

  /**
   * Get the next proxy from the legacy rotation pool
   */
  private getNextProxy(): ProxyConfig | undefined {
    const { proxies, proxyRotation = "round-robin" } = this.options;

    if (!proxies || proxies.length === 0) {
      return undefined;
    }

    if (proxyRotation === "random") {
      return proxies[Math.floor(Math.random() * proxies.length)];
    }

    // Round-robin (default)
    const proxy = proxies[this.proxyIndex % proxies.length];
    this.proxyIndex++;
    return proxy;
  }

  /**
   * Get a proxy from a specific tier pool.
   * Falls back to legacy proxy pool if tier pools not configured.
   */
  getProxyForTier(tier: "standard" | "premium"): ProxyConfig | undefined {
    const pools = this.options.proxyPools;

    if (pools) {
      const pool = tier === "premium" ? pools.premium : pools.standard;
      if (pool && pool.length > 0) {
        // Round-robin within the tier pool
        const idx = this.proxyIndex % pool.length;
        this.proxyIndex++;
        return pool[idx];
      }
    }

    // Fallback to legacy proxies
    return this.getNextProxy();
  }

  /**
   * Resolve which proxy to use based on tier preference.
   *
   * Priority: proxyTier pool > legacy proxy rotation > undefined
   */
  private resolveProxy(proxyTier?: import("./types").ProxyTier): ProxyConfig | undefined {
    if (!proxyTier) {
      // No tier specified: prefer standard pool if available, else legacy rotation
      if (this.hasProxyTier("standard")) {
        return this.getProxyForTier("standard");
      }
      return this.getNextProxy();
    }

    if (proxyTier === "premium" || proxyTier === "standard") {
      if (this.hasProxyTier(proxyTier)) {
        return this.getProxyForTier(proxyTier);
      }
      // Tier requested but not configured — fall back to legacy
      return this.getNextProxy();
    }

    return this.getNextProxy();
  }

  /**
   * Check if a proxy tier is available
   */
  hasProxyTier(tier: "standard" | "premium"): boolean {
    const pools = this.options.proxyPools;
    if (!pools) return false;
    const pool = tier === "premium" ? pools.premium : pools.standard;
    return !!pool && pool.length > 0;
  }

  /**
   * Initialize the browser pool. Called automatically on first scrape/crawl.
   * Can be called explicitly if you want to pre-warm the client.
   */
  async start(): Promise<void> {
    if (this.closed) {
      throw new Error("ReaderClient has been closed. Create a new instance.");
    }

    if (this.initialized) {
      return;
    }

    // Prevent concurrent initialization
    if (this.initializing) {
      await this.initializing;
      return;
    }

    this.initializing = this.initializeCore();
    await this.initializing;
    this.initializing = null;
  }

  /**
   * Internal initialization logic.
   *
   * Builds (in order):
   *   1. PerProxyGate  - scraper-boundary concurrency cap keyed by proxy URL.
   *   2. ProxyHealthTracker  - 10-strikes-5-min-cooldown circuit breaker.
   *   3. PlaywrightPool  - one Chrome process per proxy URL, connected via
   *      Playwright CDP. Pre-warms all browsers in parallel.
   *
   * Each Chrome instance is spawned directly via child_process.spawn,
   * and Playwright connects via CDP.
   */
  private async initializeCore(): Promise<void> {
    try {
      if (this.options.verbose) {
        logger.info("Initializing Playwright pool...");
      }

      // Build the scraper-level primitives.
      this.proxyGate = new PerProxyGate({
        maxConcurrentPerProxy: 2,
      });
      this.healthTracker = new ProxyHealthTracker();

      // Build the pool from the configured proxy pools.
      const tierConfigs = buildPlaywrightTierConfigs(this.options.proxyPools, {
        directPoolSize: this.options.browserPool?.size ?? 1,
      });

      if (this.options.verbose) {
        const summary = tierConfigs.map((t) => `${t.tier}:${t.proxyUrls.length}`).join(" ");
        logger.info(`Initializing Playwright pool (${summary})`);
      }

      this.pool = new PlaywrightPool({
        tiers: tierConfigs,
        maxTabsPerBrowser: 10,
        retireAfterPages: this.options.browserPool?.retireAfterPages ?? 100,
        showChrome: this.options.showChrome,
        userAgent: this.options.userAgent,
        healthTracker: this.healthTracker,
        logger,
      });

      await this.pool.ready;

      this.initialized = true;

      if (this.options.verbose) {
        const stats = this.pool.getStats();
        const counts = stats.tiers.map((t) => `${t.tier}=${t.browsers.length}`).join(" ");
        logger.info(`Playwright pool initialized (${counts})`);
      }
    } catch (error: any) {
      // Clean up on failure
      if (this.pool) {
        await this.pool.close().catch(() => {});
        this.pool = null;
      }
      this.proxyGate = null;
      this.healthTracker = null;
      this.initialized = false;

      const message = error.message || String(error);

      if (message.includes("chrome") || message.includes("Chrome")) {
        throw new Error(
          "Failed to initialize: Chrome/Chromium not found. " +
            "Please install Chrome or set CHROME_139_BIN environment variable."
        );
      }

      throw new Error(`Failed to initialize Playwright pool: ${message}`);
    }
  }

  /**
   * Ensure client is initialized before operation
   */
  private async ensureInitialized(): Promise<void> {
    if (this.closed) {
      throw new Error("ReaderClient has been closed. Create a new instance.");
    }

    if (!this.initialized) {
      await this.start();
    }
  }

  /**
   * Scrape one or more URLs
   *
   * @param options - Scrape options (urls, formats, etc.)
   * @returns Scrape result with data and metadata
   *
   * @example
   * const result = await reader.scrape({
   *   urls: ['https://example.com'],
   *   formats: ['markdown', 'html'],
   * });
   */
  async scrape(options: Omit<ScrapeOptions, "pool">): Promise<ScrapeResult> {
    await this.ensureInitialized();

    if (!this.pool) {
      throw new Error("Browser pool not initialized. This should not happen.");
    }

    const boundResolveProxy = (tier: ProxyTier | undefined) => this.resolveProxy(tier);

    return await scrape({
      ...options,
      proxy: options.proxy,
      showChrome: options.showChrome ?? this.options.showChrome,
      verbose: options.verbose ?? this.options.verbose,
      playwrightPool: this.pool,
      proxyGate: this.proxyGate ?? undefined,
      healthTracker: this.healthTracker ?? undefined,
      resolveProxy: boundResolveProxy,
    });
  }

  /**
   * Crawl a website to discover URLs
   *
   * @param options - Crawl options (url, depth, maxPages, etc.)
   * @returns Crawl result with discovered URLs and optional scraped content
   *
   * @example
   * const result = await reader.crawl({
   *   url: 'https://example.com',
   *   depth: 2,
   *   maxPages: 50,
   *   scrape: true,
   * });
   */
  async crawl(options: Omit<CrawlOptions, "pool">): Promise<CrawlResult> {
    await this.ensureInitialized();

    if (!this.pool) {
      throw new Error("Browser pool not initialized. This should not happen.");
    }

    const boundResolveProxy = (tier: ProxyTier | undefined) => this.resolveProxy(tier);

    return await crawl({
      ...options,
      proxy: options.proxy,
      playwrightPool: this.pool,
      proxyGate: this.proxyGate ?? undefined,
      healthTracker: this.healthTracker ?? undefined,
      resolveProxy: boundResolveProxy,
    });
  }

  /**
   * Create a browser session with a CDP WebSocket endpoint.
   *
   * Launches a Chrome instance and returns a WebSocket URL that
   * Playwright or Puppeteer can connect to via `connectOverCDP()`.
   * Anti-bot protections are active (stealth scripts, WebRTC masking, proxy routing).
   *
   * @param options - Browser session options
   * @returns Browser session with wsEndpoint and close() method
   *
   * @example
   * ```typescript
   * import { chromium } from 'playwright';
   *
   * const session = await reader.browser({ proxyTier: 'premium' });
   * const browser = await chromium.connectOverCDP(session.wsEndpoint);
   * const page = browser.contexts()[0].pages()[0];
   *
   * await page.goto('https://example.com');
   * console.log(await page.title());
   *
   * await session.close();
   * ```
   */
  async browser(options: BrowserOptions = {}): Promise<BrowserSession> {
    // No ensureInitialized() — browser sessions spawn their own Chrome process.
    // They don't need the shared pool.
    if (this.closed) {
      throw new Error("ReaderClient has been closed. Create a new instance.");
    }

    const boundResolveProxy = (tier: ProxyTier | undefined) => this.resolveProxy(tier);

    const session = await createBrowserSession({
      ...options,
      resolveProxy: boundResolveProxy,
      showChrome: options.showChrome ?? this.options.showChrome,
      verbose: options.verbose ?? this.options.verbose,
    });

    // Track active sessions so close() can clean them up
    this.activeSessions.set(session.sessionId, session);

    // Remove from tracking when the session closes
    const originalClose = session.close;
    session.close = async () => {
      this.activeSessions.delete(session.sessionId);
      await originalClose();
    };

    return session;
  }

  /**
   * Check if the client is initialized and ready
   */
  isReady(): boolean {
    return this.initialized && !this.closed;
  }

  /**
   * Close the client and release resources
   *
   * Note: This is optional - the client will auto-close on process exit.
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;

    // Remove process event handlers to allow clean exit
    this.removeCleanupHandlers();

    // Close all active browser sessions first
    if (this.activeSessions.size > 0) {
      if (this.options.verbose) {
        logger.info(`Closing ${this.activeSessions.size} active browser session(s)...`);
      }
      const sessionClosePromises = Array.from(this.activeSessions.values()).map((session) =>
        session.close().catch(() => {})
      );
      await Promise.all(sessionClosePromises);
      this.activeSessions.clear();
    }

    // Shutdown the Playwright pool (closes every Chrome in every tier)
    if (this.pool) {
      if (this.options.verbose) {
        logger.info("Shutting down Playwright pool...");
      }

      try {
        await this.pool.close();
      } catch (error: any) {
        if (this.options.verbose) {
          logger.warn(`Error shutting down pool: ${error.message}`);
        }
      }

      this.pool = null;
    }

    this.proxyGate = null;
    this.healthTracker = null;

    this.initialized = false;

    if (this.options.verbose) {
      logger.info("ReaderClient closed");
    }
  }

  /**
   * Register cleanup handlers for process exit
   */
  private registerCleanup(): void {
    this.cleanupHandler = async () => {
      await this.close();
    };

    // Handle various exit signals
    process.once("beforeExit", this.cleanupHandler);
    process.once("SIGINT", async () => {
      await this.cleanupHandler?.();
      process.exit(0);
    });
    process.once("SIGTERM", async () => {
      await this.cleanupHandler?.();
      process.exit(0);
    });
  }

  /**
   * Remove process cleanup handlers
   */
  private removeCleanupHandlers(): void {
    if (this.cleanupHandler) {
      process.removeListener("beforeExit", this.cleanupHandler);
      this.cleanupHandler = null;
    }
  }
}
