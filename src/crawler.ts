import Hero from "@ulixee/hero";
import { parseHTML } from "linkedom";
import type { IBrowserPool } from "./browser/types";
import { detectChallenge } from "./cloudflare/detector";
import { waitForChallengeResolution } from "./cloudflare/handler";
import { resolveUrl, isValidUrl, isSameDomain, getUrlKey, isContentUrl, shouldIncludeUrl } from "./utils/url-helpers";
import { fetchRobotsTxt, isUrlAllowed, type RobotsRules } from "./utils/robots-parser";
import { rateLimit } from "./utils/rate-limiter";
import { createLogger } from "./utils/logger";
import { scrape } from "./scraper";
import type { CrawlOptions, CrawlResult, CrawlUrl, CrawlMetadata } from "./crawl-types";
import type { ScrapeResult } from "./types";

/**
 * Crawler class for discovering and optionally scraping pages
 *
 * Features:
 * - BFS/DFS crawling with depth control
 * - Automatic Cloudflare challenge handling
 * - Link extraction and filtering
 * - Optional full content scraping
 * - URL deduplication
 *
 * @example
 * const crawler = new Crawler({
 *   url: 'https://example.com',
 *   depth: 2,
 *   maxPages: 20,
 *   scrape: true
 * });
 *
 * const result = await crawler.crawl();
 * console.log(`Discovered ${result.urls.length} URLs`);
 */
export class Crawler {
  private options: Omit<
    Required<CrawlOptions>,
    "proxy" | "timeoutMs" | "userAgent" | "includePatterns" | "excludePatterns" | "pool" | "removeAds" | "removeBase64Images"
  > & {
    proxy?: CrawlOptions["proxy"];
    timeoutMs?: CrawlOptions["timeoutMs"];
    userAgent?: CrawlOptions["userAgent"];
    includePatterns?: string[];
    excludePatterns?: string[];
    removeAds?: boolean;
    removeBase64Images?: boolean;
  };
  private visited: Set<string> = new Set();
  private queue: Array<{ url: string; depth: number }> = [];
  private urls: CrawlUrl[] = [];
  private pool: IBrowserPool;
  private logger = createLogger("crawler");
  private robotsRules: RobotsRules | null = null;

  constructor(options: CrawlOptions) {
    // Pool must be provided by client
    if (!options.pool) {
      throw new Error("Browser pool must be provided. Use ReaderClient for automatic pool management.");
    }
    this.pool = options.pool;

    this.options = {
      url: options.url,
      depth: options.depth || 1,
      maxPages: options.maxPages || 20,
      scrape: options.scrape || false,
      delayMs: options.delayMs || 1000,
      timeoutMs: options.timeoutMs,
      includePatterns: options.includePatterns,
      excludePatterns: options.excludePatterns,
      formats: options.formats || ["markdown", "html"],
      scrapeConcurrency: options.scrapeConcurrency || 2,
      proxy: options.proxy,
      userAgent: options.userAgent,
      verbose: options.verbose || false,
      showChrome: options.showChrome || false,
      connectionToCore: options.connectionToCore,
      // Content cleaning options
      removeAds: options.removeAds,
      removeBase64Images: options.removeBase64Images,
    };
  }

  /**
   * Start crawling
   */
  async crawl(): Promise<CrawlResult> {
    const startTime = Date.now();

    // Fetch robots.txt rules before crawling
    this.robotsRules = await fetchRobotsTxt(this.options.url);
    if (this.robotsRules) {
      this.logger.info("Loaded robots.txt rules");
    }

    // Pool is managed by ReaderClient - just use it
    // Add seed URL to queue (if allowed by robots.txt)
    if (isUrlAllowed(this.options.url, this.robotsRules)) {
      this.queue.push({ url: this.options.url, depth: 0 });
    } else {
      this.logger.warn(`Seed URL blocked by robots.txt: ${this.options.url}`);
    }

    // Crawl URLs
    while (this.queue.length > 0 && this.urls.length < this.options.maxPages) {
      // Check timeout
      if (this.options.timeoutMs && Date.now() - startTime > this.options.timeoutMs) {
        this.logger.warn(`Crawl timed out after ${this.options.timeoutMs}ms`);
        break;
      }

      const item = this.queue.shift()!;
      const urlKey = getUrlKey(item.url);

      if (this.visited.has(urlKey)) {
        continue;
      }

      // Fetch page
      const result = await this.fetchPage(item.url);

      if (result) {
        this.urls.push(result.crawlUrl);
        this.visited.add(urlKey);

        // Extract links from the fetched HTML if not at max depth
        if (item.depth < this.options.depth) {
          const links = this.extractLinks(result.html, item.url, item.depth + 1);
          this.queue.push(...links);
        }
      }

      // Rate limit (use robots.txt crawl-delay if specified, otherwise use configured delay)
      const delay = this.robotsRules?.crawlDelay || this.options.delayMs;
      await rateLimit(delay);
    }

    // Build metadata
    const metadata: CrawlMetadata = {
      totalUrls: this.urls.length,
      maxDepth: this.options.depth,
      totalDuration: Date.now() - startTime,
      seedUrl: this.options.url,
    };

    // Optionally scrape all discovered URLs
    let scraped: ScrapeResult | undefined;
    if (this.options.scrape) {
      scraped = await this.scrapeDiscoveredUrls();
    }

    return {
      urls: this.urls,
      scraped,
      metadata,
    };
  }

  /**
   * Fetch a single page and extract basic info
   */
  private async fetchPage(url: string): Promise<{ crawlUrl: CrawlUrl; html: string } | null> {
    try {
      return await this.pool.withBrowser(async (hero: Hero) => {
        // Navigate
        await hero.goto(url, { timeoutMs: 30000 });
        await hero.waitForPaintingStable();

        // Handle Cloudflare challenge
        const initialUrl = await hero.url;
        const detection = await detectChallenge(hero);

        if (detection.isChallenge) {
          if (this.options.verbose) {
            this.logger.info(`Challenge detected on ${url}`);
          }

          const result = await waitForChallengeResolution(hero, {
            maxWaitMs: 45000,
            pollIntervalMs: 500,
            verbose: this.options.verbose,
            initialUrl,
          });

          if (!result.resolved) {
            throw new Error(`Challenge not resolved`);
          }
        }

        // Extract basic info and HTML
        const title = await hero.document.title;
        const html = await hero.document.documentElement.outerHTML;

        // Try to extract description from meta tags
        let description: string | null = null;
        try {
          const metaDesc = await hero.document.querySelector('meta[name="description"]');
          if (metaDesc) {
            description = await metaDesc.getAttribute("content");
          }
        } catch {
          // No description found
        }

        return {
          crawlUrl: {
            url,
            title: title || "Untitled",
            description,
          },
          html,
        };
      });
    } catch (error: any) {
      this.logger.error(`Failed to fetch ${url}: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract links from HTML content using DOM parsing
   * Handles all href formats (single quotes, double quotes, unquoted)
   */
  private extractLinks(
    html: string,
    baseUrl: string,
    depth: number
  ): Array<{ url: string; depth: number }> {
    const links: Array<{ url: string; depth: number }> = [];
    const { document } = parseHTML(html);

    // Use proper DOM API to find all anchor elements with href
    document.querySelectorAll("a[href]").forEach((anchor: Element) => {
      const rawHref = anchor.getAttribute("href");
      if (!rawHref) return;

      // Trim whitespace from href
      const href = rawHref.trim();
      if (!href) return;

      // Skip fragment-only links (#, #section, etc.)
      if (href.startsWith("#")) return;

      // Skip non-HTTP schemes (javascript:, mailto:, tel:, data:, blob:, ftp:)
      const lowerHref = href.toLowerCase();
      if (
        lowerHref.startsWith("javascript:") ||
        lowerHref.startsWith("mailto:") ||
        lowerHref.startsWith("tel:") ||
        lowerHref.startsWith("data:") ||
        lowerHref.startsWith("blob:") ||
        lowerHref.startsWith("ftp:")
      ) {
        return;
      }

      // Resolve relative URLs
      let resolved = resolveUrl(href, baseUrl);
      if (!resolved || !isValidUrl(resolved)) return;

      // Strip hash fragments from URLs
      try {
        const parsed = new URL(resolved);
        parsed.hash = "";
        resolved = parsed.toString();
      } catch {
        return;
      }

      // Check if same domain
      if (!isSameDomain(resolved, this.options.url)) return;

      // Check if content page (skip legal, policy, utility pages)
      if (!isContentUrl(resolved)) return;

      // Check include/exclude patterns
      if (!shouldIncludeUrl(resolved, this.options.includePatterns, this.options.excludePatterns)) return;

      // Check if allowed by robots.txt
      if (!isUrlAllowed(resolved, this.robotsRules)) return;

      // Check if already visited or queued
      const urlKey = getUrlKey(resolved);
      if (this.visited.has(urlKey) || this.queue.some((q) => getUrlKey(q.url) === urlKey)) {
        return;
      }

      links.push({ url: resolved, depth });
    });

    return links;
  }

  /**
   * Scrape all discovered URLs
   */
  private async scrapeDiscoveredUrls(): Promise<ScrapeResult> {
    const urls = this.urls.map((u) => u.url);

    return scrape({
      urls,
      formats: this.options.formats,
      batchConcurrency: this.options.scrapeConcurrency,
      proxy: this.options.proxy,
      userAgent: this.options.userAgent,
      verbose: this.options.verbose,
      showChrome: this.options.showChrome,
      pool: this.pool,
      // Content cleaning options
      removeAds: this.options.removeAds,
      removeBase64Images: this.options.removeBase64Images,
    });
  }
}

/**
 * Convenience function to crawl a website
 *
 * @param options - Crawl options
 * @returns Crawl result
 *
 * @example
 * const result = await crawl({
 *   url: 'https://example.com',
 *   depth: 2,
 *   maxPages: 20,
 *   scrape: true
 * });
 */
export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const crawler = new Crawler(options);
  return crawler.crawl();
}
