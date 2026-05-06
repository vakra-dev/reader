/**
 * ReaderClient
 *
 * A client wrapper that manages HeroCore lifecycle and provides
 * a simple interface for scraping and crawling.
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

import HeroCore from "@ulixee/hero-core";
import { TransportBridge } from "@ulixee/net";
import { ConnectionToHeroCore } from "@ulixee/hero";
import { scrape } from "./scraper";
import { crawl } from "./crawler";
import { createBrowserSession } from "./browser-session";
import type { BrowserOptions, BrowserSession } from "./browser-types";
import { TieredBrowserPool, buildTierConfigsFromPools } from "./browser/tiered-pool";
import type { HeroFactory } from "./browser/proxy-bound-browser";
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
   *   datacenter: [{ url: "http://dc-proxy:port" }],
   *   residential: [{ url: "http://res-proxy:port" }],
   * }
   */
  proxyPools?: ProxyPoolConfig;

  /** Proxy rotation strategy (default: "round-robin") */
  proxyRotation?: ProxyRotation;

  /**
   * Custom user agent string. Overrides Hero's default emulated UA.
   * Applied to all browsers in the pool.
   *
   * WARNING: Hero's default UA matches the Chromium TLS fingerprint.
   * Overriding can cause TLS/UA mismatches detected by anti-bot systems.
   */
  userAgent?: string;

  /** Skip TLS/SSL certificate verification (default: true) */
  skipTLSVerification?: boolean;
}

/**
 * ReaderClient manages the HeroCore lifecycle and provides
 * scrape/crawl methods with automatic initialization.
 */
export class ReaderClient {
  private heroCore: HeroCore | null = null;
  private tieredPool: TieredBrowserPool | null = null;
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

    // Configure TLS verification
    // Hero uses MITM_ALLOW_INSECURE env var to skip certificate verification
    // Default is true (skip verification) for compatibility with various sites
    const skipTLS = options.skipTLSVerification ?? true;
    if (skipTLS) {
      process.env.MITM_ALLOW_INSECURE = "true";
    }

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
  getProxyForTier(tier: "datacenter" | "residential"): ProxyConfig | undefined {
    const pools = this.options.proxyPools;

    if (pools) {
      const pool = tier === "residential" ? pools.residential : pools.datacenter;
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
   *
   * For "auto" tier: starts with datacenter (caller handles escalation on block detection).
   */
  private resolveProxy(proxyTier?: import("./types").ProxyTier): ProxyConfig | undefined {
    if (!proxyTier || proxyTier === "auto") {
      // Auto: prefer datacenter pool if available, else legacy rotation
      if (this.hasProxyTier("datacenter")) {
        return this.getProxyForTier("datacenter");
      }
      return this.getNextProxy();
    }

    if (proxyTier === "residential" || proxyTier === "datacenter") {
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
  hasProxyTier(tier: "datacenter" | "residential"): boolean {
    const pools = this.options.proxyPools;
    if (!pools) return false;
    const pool = tier === "residential" ? pools.residential : pools.datacenter;
    return !!pool && pool.length > 0;
  }

  /**
   * Initialize HeroCore. Called automatically on first scrape/crawl.
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
   *   1. HeroCore  - shared Hero runtime for every browser in every tier.
   *   2. PerProxyGate  - scraper-boundary concurrency cap keyed by proxy URL.
   *   3. ProxyHealthTracker  - 10-strikes-5-min-cooldown circuit breaker.
   *   4. TieredBrowserPool  - one ProxyBoundBrowser per proxy URL, grouped
   *      by tier. Pre-warms all browsers in parallel; `pool.ready` awaits
   *      every browser's initial launch attempt (success or failure).
   *
   * `this.options.browserPool?.directPoolSize` controls how many direct
   * browsers to spin up when no proxies are configured (local dev, CI).
   */
  private async initializeCore(): Promise<void> {
    try {
      if (this.options.verbose) {
        logger.info("Starting HeroCore...");
      }

      this.heroCore = new HeroCore();
      await this.heroCore.start();

      if (this.options.verbose) {
        logger.info("HeroCore started successfully");
      }

      // Build the scraper-level primitives.
      this.proxyGate = new PerProxyGate({
        maxConcurrentPerProxy: 2, // default; domain profiles can tighten
      });
      this.healthTracker = new ProxyHealthTracker();

      // Build the tiered browser pool from the configured proxy pools.
      const tierConfigs = buildTierConfigsFromPools(this.options.proxyPools, {
        directPoolSize: this.options.browserPool?.size ?? 1,
      });

      if (this.options.verbose) {
        const summary = tierConfigs.map((t) => `${t.tier}:${t.proxyUrls.length}`).join(" ");
        logger.info(`Initializing tiered browser pool (${summary})`);
      }

      this.tieredPool = new TieredBrowserPool({
        tiers: tierConfigs,
        maxTabsPerBrowser: 2,
        retireAfterPages: this.options.browserPool?.retireAfterPages ?? 100,
        healthTracker: this.healthTracker,
        heroFactory: undefined as HeroFactory | undefined, // use real factory
        showChrome: this.options.showChrome,
        connectionToCore: this.createConnection(),
        userAgent: this.options.userAgent,
        logger,
      });

      // Pre-warm: await every browser's initial launch attempt. Per-browser
      // failures are already logged and swallowed; they don't block the
      // pool's ready promise. The separate startup api.ipify.org check
      // (added in a later item) will fail loud if any proxy is dead.
      await this.tieredPool.ready;

      this.initialized = true;

      if (this.options.verbose) {
        const stats = this.tieredPool.getStats();
        const counts = stats.tiers.map((t) => `${t.tier}=${t.browsers.length}`).join(" ");
        logger.info(`Browser pool initialized (${counts})`);
      }
    } catch (error: any) {
      // Clean up on failure
      if (this.tieredPool) {
        await this.tieredPool.close().catch(() => {});
        this.tieredPool = null;
      }
      this.proxyGate = null;
      this.healthTracker = null;
      if (this.heroCore) {
        await this.heroCore.close().catch(() => {});
        this.heroCore = null;
      }
      this.initialized = false;

      // Provide helpful error messages
      const message = error.message || String(error);

      if (message.includes("EADDRINUSE")) {
        throw new Error(
          "Failed to start HeroCore: Port already in use. " +
            "Another instance may be running. " +
            "Close it or use a different port."
        );
      }

      if (message.includes("chrome") || message.includes("Chrome")) {
        throw new Error(
          "Failed to start HeroCore: Chrome/Chromium not found. " +
            "Please install Chrome or set CHROME_PATH environment variable."
        );
      }

      throw new Error(`Failed to start HeroCore: ${message}`);
    }
  }

  /**
   * Create a connection to the HeroCore instance
   */
  private createConnection(): ConnectionToHeroCore {
    if (!this.heroCore) {
      throw new Error("HeroCore not initialized. This should not happen.");
    }

    const bridge = new TransportBridge();
    this.heroCore.addConnection(bridge.transportToClient);
    return new ConnectionToHeroCore(bridge.transportToCore);
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
  async scrape(options: Omit<ScrapeOptions, "connectionToCore" | "pool">): Promise<ScrapeResult> {
    await this.ensureInitialized();

    if (!this.tieredPool) {
      throw new Error("Browser pool not initialized. This should not happen.");
    }

    // Bind `resolveProxy` to `this` so the scraper can call it per-attempt
    // without losing the client context.
    const boundResolveProxy = (tier: ProxyTier | undefined) => this.resolveProxy(tier);

    return await scrape({
      ...options,
      // Caller may still pass an explicit proxy to opt out of tier routing.
      proxy: options.proxy,
      showChrome: options.showChrome ?? this.options.showChrome,
      verbose: options.verbose ?? this.options.verbose,
      tieredPool: this.tieredPool,
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
  async crawl(options: Omit<CrawlOptions, "connectionToCore" | "pool">): Promise<CrawlResult> {
    await this.ensureInitialized();

    if (!this.tieredPool) {
      throw new Error("Browser pool not initialized. This should not happen.");
    }

    const boundResolveProxy = (tier: ProxyTier | undefined) => this.resolveProxy(tier);

    return await crawl({
      ...options,
      proxy: options.proxy,
      tieredPool: this.tieredPool,
      proxyGate: this.proxyGate ?? undefined,
      healthTracker: this.healthTracker ?? undefined,
      resolveProxy: boundResolveProxy,
    });
  }

  /**
   * Create a browser session with a CDP WebSocket endpoint.
   *
   * Launches a Hero-stealthed Chrome and returns a WebSocket URL that
   * Playwright or Puppeteer can connect to via `connectOverCDP()`.
   * Full anti-bot stealth is active (TLS fingerprinting, navigator
   * spoofing, WebRTC masking, MITM proxy).
   *
   * @param options - Browser session options
   * @returns Browser session with wsEndpoint and close() method
   *
   * @example
   * ```typescript
   * import { chromium } from 'playwright';
   *
   * const session = await reader.browser({ proxyTier: 'residential' });
   * const browser = await chromium.connectOverCDP(session.wsEndpoint);
   * const page = browser.contexts()[0].pages()[0];
   *
   * await page.goto('https://example.com');
   * console.log(await page.title());
   *
   * await session.close();
   * ```
   */
  async browser(options: Omit<BrowserOptions, "connectionToCore"> = {}): Promise<BrowserSession> {
    // No ensureInitialized() — browser sessions create their own dedicated
    // HeroCore instance. They don't need the shared pool or HeroCore.
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

    // Shutdown the tiered pool first (closes every browser in every tier)
    if (this.tieredPool) {
      if (this.options.verbose) {
        logger.info("Shutting down tiered browser pool...");
      }

      try {
        await this.tieredPool.close();
      } catch (error: any) {
        if (this.options.verbose) {
          logger.warn(`Error shutting down pool: ${error.message}`);
        }
      }

      this.tieredPool = null;
    }

    this.proxyGate = null;
    this.healthTracker = null;

    // Then close HeroCore
    if (this.heroCore) {
      if (this.options.verbose) {
        logger.info("Closing HeroCore...");
      }

      try {
        await this.heroCore.close();
        // Also call static shutdown to clean up any remaining resources
        await HeroCore.shutdown();
      } catch (error: any) {
        // Ignore close errors
        if (this.options.verbose) {
          logger.warn(`Error closing HeroCore: ${error.message}`);
        }
      }

      this.heroCore = null;
    }

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
