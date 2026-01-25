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
import { HeroBrowserPool } from "./browser/pool";
import type { ScrapeOptions, ScrapeResult, ProxyConfig, BrowserPoolConfig } from "./types";
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

  /** List of proxies to rotate through */
  proxies?: ProxyConfig[];

  /** Proxy rotation strategy (default: "round-robin") */
  proxyRotation?: ProxyRotation;

  /** Skip TLS/SSL certificate verification (default: true) */
  skipTLSVerification?: boolean;
}

/**
 * ReaderClient manages the HeroCore lifecycle and provides
 * scrape/crawl methods with automatic initialization.
 */
export class ReaderClient {
  private heroCore: HeroCore | null = null;
  private pool: HeroBrowserPool | null = null;
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private closed = false;
  private options: ReaderClientOptions;
  private proxyIndex = 0;
  private cleanupHandler: (() => Promise<void>) | null = null;

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
   * Get the next proxy from the rotation pool
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
   * Internal initialization logic
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

      // Initialize browser pool
      if (this.options.verbose) {
        logger.info("Initializing browser pool...");
      }

      const browserPoolConfig = this.options.browserPool;
      const poolConfig = {
        size: browserPoolConfig?.size ?? 2,
        retireAfterPageCount: browserPoolConfig?.retireAfterPages ?? 100,
        retireAfterAgeMs: (browserPoolConfig?.retireAfterMinutes ?? 30) * 60 * 1000,
        maxQueueSize: browserPoolConfig?.maxQueueSize ?? 100,
      };

      this.pool = new HeroBrowserPool(
        poolConfig,
        undefined, // proxy set per-request
        this.options.showChrome,
        this.createConnection(),
        undefined, // userAgent
        this.options.verbose
      );
      await this.pool.initialize();

      this.initialized = true;

      if (this.options.verbose) {
        logger.info("Browser pool initialized successfully");
      }
    } catch (error: any) {
      // Clean up on failure
      if (this.pool) {
        await this.pool.shutdown().catch(() => {});
        this.pool = null;
      }
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

    if (!this.pool) {
      throw new Error("Browser pool not initialized. This should not happen.");
    }

    // Use proxy rotation if proxies are configured and no specific proxy is provided
    const proxy = options.proxy ?? this.getNextProxy();

    return await scrape({
      ...options,
      proxy,
      showChrome: options.showChrome ?? this.options.showChrome,
      verbose: options.verbose ?? this.options.verbose,
      pool: this.pool,
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

    if (!this.pool) {
      throw new Error("Browser pool not initialized. This should not happen.");
    }

    // Use proxy rotation if proxies are configured and no specific proxy is provided
    const proxy = options.proxy ?? this.getNextProxy();

    return await crawl({
      ...options,
      proxy,
      pool: this.pool,
    });
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

    // Shutdown pool first (closes browser instances)
    if (this.pool) {
      if (this.options.verbose) {
        logger.info("Shutting down browser pool...");
      }

      try {
        await this.pool.shutdown();
      } catch (error: any) {
        if (this.options.verbose) {
          logger.warn(`Error shutting down pool: ${error.message}`);
        }
      }

      this.pool = null;
    }

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
