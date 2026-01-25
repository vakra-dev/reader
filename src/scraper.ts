import Hero from "@ulixee/hero";
import pLimit from "p-limit";
import type { IBrowserPool } from "./browser/types";
import { detectChallenge } from "./cloudflare/detector";
import { waitForChallengeResolution } from "./cloudflare/handler";
import { htmlToMarkdown } from "./formatters/markdown";
import { cleanContent } from "./utils/content-cleaner";
import { extractMetadata } from "./utils/metadata-extractor";
import { createLogger } from "./utils/logger";
import { fetchRobotsTxt, isUrlAllowed, type RobotsRules } from "./utils/robots-parser";
import {
  DEFAULT_OPTIONS,
  type ScrapeOptions,
  type ScrapeResult,
  type WebsiteScrapeResult,
  type BatchMetadata,
  type ProxyMetadata,
} from "./types";

/**
 * Scraper class with built-in concurrency support
 *
 * Features:
 * - Hero-based browser automation
 * - Automatic Cloudflare challenge detection and bypass
 * - Built-in concurrency via browser pool
 * - Progress tracking
 * - Error handling per URL
 *
 * @example
 * const scraper = new Scraper({
 *   urls: ['https://example.com', 'https://example.org'],
 *   formats: ['markdown', 'html'],
 *   batchConcurrency: 2,
 *   proxy: { type: 'residential', ... }
 * });
 *
 * const result = await scraper.scrape();
 * console.log(`Scraped ${result.batchMetadata.successfulUrls} URLs`);
 */
export class Scraper {
  private options: Required<ScrapeOptions>;
  private pool: IBrowserPool;
  private logger = createLogger("scraper");
  private robotsCache: Map<string, RobotsRules | null> = new Map();

  constructor(options: ScrapeOptions) {
    // Merge with defaults
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    } as Required<ScrapeOptions>;

    // Pool must be provided by client
    if (!options.pool) {
      throw new Error("Browser pool must be provided. Use ReaderClient for automatic pool management.");
    }
    this.pool = options.pool;
  }

  /**
   * Get robots.txt rules for a URL, cached per domain
   */
  private async getRobotsRules(url: string): Promise<RobotsRules | null> {
    const origin = new URL(url).origin;
    if (!this.robotsCache.has(origin)) {
      const rules = await fetchRobotsTxt(origin);
      this.robotsCache.set(origin, rules);
    }
    return this.robotsCache.get(origin) ?? null;
  }

  /**
   * Scrape all URLs
   *
   * @returns Scrape result with pages and metadata
   */
  async scrape(): Promise<ScrapeResult> {
    const startTime = Date.now();

    // Pool is managed by ReaderClient - just use it
    // Scrape URLs with concurrency control
    const results = await this.scrapeWithConcurrency();

    // Build response
    return this.buildScrapeResult(results, startTime);
  }

  /**
   * Scrape URLs with concurrency control
   */
  private async scrapeWithConcurrency(): Promise<
    Array<{ result: WebsiteScrapeResult | null; error?: string }>
  > {
    const limit = pLimit(this.options.batchConcurrency || 1);
    const tasks = this.options.urls.map((url, index) =>
      limit(() => this.scrapeSingleUrlWithRetry(url, index))
    );

    const batchPromise = Promise.all(tasks);

    // Apply batch timeout if specified
    if (this.options.batchTimeoutMs && this.options.batchTimeoutMs > 0) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Batch operation timed out after ${this.options.batchTimeoutMs}ms`));
        }, this.options.batchTimeoutMs);
      });

      return Promise.race([batchPromise, timeoutPromise]);
    }

    return batchPromise;
  }

  /**
   * Scrape a single URL with retry logic
   */
  private async scrapeSingleUrlWithRetry(
    url: string,
    index: number
  ): Promise<{ result: WebsiteScrapeResult | null; error?: string }> {
    const maxRetries = this.options.maxRetries || 2;
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.scrapeSingleUrl(url, index);
        if (result) {
          return { result };
        }
        // Result is null but no exception - unexpected state
        lastError = `Failed to scrape ${url}: No content returned`;
      } catch (error: any) {
        lastError = error.message;
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s...
          const delay = Math.pow(2, attempt) * 1000;
          this.logger.warn(`Retry ${attempt + 1}/${maxRetries} for ${url} in ${delay}ms`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    this.logger.error(`Failed to scrape ${url} after ${maxRetries + 1} attempts: ${lastError}`);
    return { result: null, error: lastError };
  }

  /**
   * Wait for the final page to load after any Cloudflare redirects
   * Cloudflare often does silent redirects even when bypassed, we need to ensure
   * we're on the actual content page before scraping.
   */
  private async waitForFinalPage(hero: Hero, originalUrl: string, verbose: boolean): Promise<void> {
    const maxWaitMs = 15000;
    const startTime = Date.now();
    const log = (msg: string) => verbose && this.logger.info(msg);

    // Wait for any pending navigation to complete
    try {
      await hero.waitForLoad("AllContentLoaded", { timeoutMs: maxWaitMs });
    } catch {
      // Timeout is OK
    }

    // Check if URL changed (Cloudflare redirect)
    // Normalize URLs by removing trailing slashes for comparison
    let currentUrl = await hero.url;
    const normalizeUrl = (url: string) => url.replace(/\/+$/, "");
    const urlChanged = normalizeUrl(currentUrl) !== normalizeUrl(originalUrl);

    if (urlChanged || currentUrl.includes("__cf_chl")) {
      log(`Cloudflare redirect detected: ${originalUrl} → ${currentUrl}`);

      // Wait for the redirect to complete and new page to load
      // Poll until URL stabilizes and page is loaded
      let lastUrl = currentUrl;
      let stableCount = 0;

      while (Date.now() - startTime < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, 500));

        try {
          currentUrl = await hero.url;

          // URL is stable if it hasn't changed for 2 consecutive checks
          if (currentUrl === lastUrl) {
            stableCount++;
            if (stableCount >= 2) {
              break;
            }
          } else {
            stableCount = 0;
            lastUrl = currentUrl;
            log(`URL changed to: ${currentUrl}`);
          }
        } catch {
          // Error getting URL, continue waiting
        }
      }

      // Final wait for page content to render
      try {
        await hero.waitForLoad("AllContentLoaded", { timeoutMs: 10000 });
      } catch {
        // Timeout OK
      }
    }

    // Final stabilization
    await hero.waitForPaintingStable();

    // Buffer for JS execution and dynamic content loading
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  /**
   * Scrape a single URL
   */
  private async scrapeSingleUrl(url: string, index: number): Promise<WebsiteScrapeResult | null> {
    const startTime = Date.now();

    // Check robots.txt before scraping
    const robotsRules = await this.getRobotsRules(url);
    if (!isUrlAllowed(url, robotsRules)) {
      throw new Error(`URL blocked by robots.txt: ${url}`);
    }

    try {
      return await this.pool.withBrowser(async (hero: Hero) => {
        // Navigate to URL
        await hero.goto(url, { timeoutMs: this.options.timeoutMs });

        // Wait for initial page load
        try {
          await hero.waitForLoad("DomContentLoaded", { timeoutMs: this.options.timeoutMs });
        } catch {
          // Timeout is OK, continue anyway
        }
        await hero.waitForPaintingStable();

        // Detect and handle Cloudflare challenge
        const initialUrl = await hero.url;
        const detection = await detectChallenge(hero);

        if (detection.isChallenge) {
          if (this.options.verbose) {
            this.logger.info(`Challenge detected on ${url}: ${detection.type}`);
          }

          // Wait for resolution
          const result = await waitForChallengeResolution(hero, {
            maxWaitMs: 45000,
            pollIntervalMs: 500,
            verbose: this.options.verbose,
            initialUrl,
          });

          if (!result.resolved) {
            throw new Error(`Challenge not resolved: ${detection.type}`);
          }

          if (this.options.verbose) {
            this.logger.info(`Challenge resolved via ${result.method} in ${result.waitedMs}ms`);
          }
        }

        // Wait for any Cloudflare redirects to complete
        // Cloudflare often does a silent redirect after bypass, we need to wait for the final page
        await this.waitForFinalPage(hero, url, this.options.verbose);

        // Wait for selector if specified
        if (this.options.waitForSelector) {
          try {
            await hero.waitForElement(hero.document.querySelector(this.options.waitForSelector), {
              timeoutMs: this.options.timeoutMs,
            });
          } catch (error) {
            this.logger.warn(`Selector not found: ${this.options.waitForSelector}`);
          }
        }

        // Extract content
        const html = await hero.document.documentElement.outerHTML;

        // Clean content with configurable options
        const cleanedHtml = cleanContent(html, url, {
          removeAds: this.options.removeAds,
          removeBase64Images: this.options.removeBase64Images,
          onlyMainContent: this.options.onlyMainContent,
          includeTags: this.options.includeTags,
          excludeTags: this.options.excludeTags,
        });

        // Extract metadata
        const websiteMetadata = extractMetadata(cleanedHtml, url);

        const duration = Date.now() - startTime;

        // Convert to requested formats
        const markdown = this.options.formats.includes("markdown")
          ? htmlToMarkdown(cleanedHtml)
          : undefined;

        const htmlOutput = this.options.formats.includes("html")
          ? cleanedHtml
          : undefined;

        // Report progress
        if (this.options.onProgress) {
          this.options.onProgress({
            completed: index + 1,
            total: this.options.urls.length,
            currentUrl: url,
          });
        }

        // Build proxy metadata if proxy was used
        let proxyMetadata: ProxyMetadata | undefined;
        if (this.options.proxy) {
          const proxy = this.options.proxy;
          // Extract host and port from either url or direct config
          if (proxy.url) {
            try {
              const proxyUrl = new URL(proxy.url);
              proxyMetadata = {
                host: proxyUrl.hostname,
                port: parseInt(proxyUrl.port, 10) || 80,
                country: proxy.country,
              };
            } catch {
              // Invalid URL, skip proxy metadata
            }
          } else if (proxy.host && proxy.port) {
            proxyMetadata = {
              host: proxy.host,
              port: proxy.port,
              country: proxy.country,
            };
          }
        }

        // Build result
        const result: WebsiteScrapeResult = {
          markdown,
          html: htmlOutput,
          metadata: {
            baseUrl: url,
            totalPages: 1,
            scrapedAt: new Date().toISOString(),
            duration,
            website: websiteMetadata,
            proxy: proxyMetadata,
          },
        };

        return result;
      });
    } catch (error: any) {
      this.logger.error(`Failed to scrape ${url}: ${error.message}`);

      // Report progress (failed)
      if (this.options.onProgress) {
        this.options.onProgress({
          completed: index + 1,
          total: this.options.urls.length,
          currentUrl: url,
        });
      }

      return null; // Return null for failed URLs
    }
  }

  /**
   * Build final scrape result
   */
  private buildScrapeResult(
    results: Array<{ result: WebsiteScrapeResult | null; error?: string }>,
    startTime: number
  ): ScrapeResult {
    const successful = results
      .filter((r) => r.result !== null)
      .map((r) => r.result as WebsiteScrapeResult);

    const errors: Array<{ url: string; error: string }> = [];
    results.forEach((r, index) => {
      if (r.result === null && r.error) {
        errors.push({ url: this.options.urls[index], error: r.error });
      }
    });

    const batchMetadata: BatchMetadata = {
      totalUrls: this.options.urls.length,
      successfulUrls: successful.length,
      failedUrls: results.filter((r) => r.result === null).length,
      scrapedAt: new Date().toISOString(),
      totalDuration: Date.now() - startTime,
      errors,
    };

    return {
      data: successful,
      batchMetadata,
    };
  }
}

/**
 * Convenience function to scrape URLs
 *
 * @param options - Scrape options
 * @returns Scrape result
 *
 * @example
 * const result = await scrape({
 *   urls: ['https://example.com'],
 *   formats: ['markdown']
 * });
 */
export async function scrape(options: ScrapeOptions): Promise<ScrapeResult> {
  const scraper = new Scraper(options);
  return scraper.scrape();
}
