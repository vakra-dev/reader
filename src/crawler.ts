import { parseHTML } from "linkedom";
import {
  resolveUrl,
  isValidUrl,
  isSameDomain,
  getUrlKey,
  isContentUrl,
  shouldIncludeUrl,
} from "./utils/url-helpers";
import { fetchRobotsTxt, isUrlAllowed, type RobotsRules } from "./utils/robots-parser";
import { rateLimit } from "./utils/rate-limiter";
import { createLogger } from "./utils/logger";
import { scrape } from "./scraper";
import type { CrawlOptions, CrawlResult, CrawlUrl, CrawlMetadata } from "./crawl-types";
import type { ScrapeResult } from "./types";

/**
 * Crawler class for discovering and optionally scraping pages.
 *
 * Discovery and scraping both go through the scraper, which handles
 * Hero, proxy escalation, and timeouts. The crawler owns BFS traversal,
 * link extraction, deduplication, robots.txt, and rate limiting.
 */
export class Crawler {
  private options: CrawlOptions;
  private visited: Set<string> = new Set();
  private queue: Array<{ url: string; depth: number }> = [];
  private urls: CrawlUrl[] = [];
  private logger = createLogger("crawler");
  private robotsRules: RobotsRules | null = null;

  constructor(options: CrawlOptions) {
    this.options = {
      depth: 1,
      maxPages: 20,
      scrape: false,
      delayMs: 1000,
      formats: ["markdown", "html"],
      scrapeConcurrency: 2,
      verbose: false,
      showChrome: false,
      ...options,
    };
  }

  /**
   * Start crawling
   */
  async crawl(): Promise<CrawlResult> {
    const startTime = Date.now();

    // Fetch robots.txt rules
    this.robotsRules = await fetchRobotsTxt(this.options.url);
    if (this.robotsRules) {
      this.logger.info("Loaded robots.txt rules");
    }

    // Add seed URL to queue
    if (isUrlAllowed(this.options.url, this.robotsRules)) {
      this.queue.push({ url: this.options.url, depth: 0 });
    } else {
      this.logger.warn(`Seed URL blocked by robots.txt: ${this.options.url}`);
    }

    // BFS crawl
    while (this.queue.length > 0 && this.urls.length < (this.options.maxPages ?? 20)) {
      if (this.options.timeoutMs && Date.now() - startTime > this.options.timeoutMs) {
        this.logger.warn(`Crawl timed out after ${this.options.timeoutMs}ms`);
        break;
      }

      const item = this.queue.shift()!;
      const urlKey = getUrlKey(item.url);

      if (this.visited.has(urlKey)) {
        continue;
      }

      // Fetch page via scraper
      const result = await this.fetchPage(item.url);

      if (result) {
        this.urls.push(result.crawlUrl);
        this.visited.add(urlKey);

        // Extract links if not at max depth
        if (item.depth < (this.options.depth ?? 1)) {
          const links = this.extractLinks(result.html, item.url, item.depth + 1);
          this.queue.push(...links);
        }
      }

      // Rate limit
      const delay = this.robotsRules?.crawlDelay || (this.options.delayMs ?? 1000);
      await rateLimit(delay);
    }

    const metadata: CrawlMetadata = {
      totalUrls: this.urls.length,
      maxDepth: this.options.depth ?? 1,
      totalDuration: Date.now() - startTime,
      seedUrl: this.options.url,
    };

    // Optionally scrape all discovered URLs for content
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
   * Fetch a single page for discovery using the scraper.
   *
   * Calls scrape() with onlyMainContent=false so link extraction gets
   * the full page HTML. The scraper handles Hero, proxy escalation,
   * and timeouts internally.
   */
  private async fetchPage(url: string): Promise<{ crawlUrl: CrawlUrl; html: string } | null> {
    try {
      const result = await scrape({
        urls: [url],
        formats: [], // We only need rawHtml for discovery
        onlyMainContent: false,
        proxy: this.options.proxy,
        proxyTier: this.options.proxyTier,
        timeoutMs: this.options.timeoutMs,
        verbose: this.options.verbose,
        showChrome: this.options.showChrome,
        connectionToCore: this.options.connectionToCore,
        pool: this.options.pool,
        tieredPool: this.options.tieredPool,
        proxyGate: this.options.proxyGate,
        healthTracker: this.options.healthTracker,
        resolveProxy: this.options.resolveProxy,
      });

      if (result.data.length === 0) {
        this.logger.warn(`[crawler] No data returned for ${url}`);
        return null;
      }

      const page = result.data[0];

      return {
        crawlUrl: {
          url: page.metadata.baseUrl,
          title: page.metadata.website?.title || "Untitled",
          description: page.metadata.website?.description ?? null,
        },
        html: page.rawHtml,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[crawler] Failed to fetch ${url}: ${msg}`);
      return null;
    }
  }

  /**
   * Extract links from HTML content using DOM parsing
   */
  private extractLinks(
    html: string,
    baseUrl: string,
    depth: number
  ): Array<{ url: string; depth: number }> {
    const links: Array<{ url: string; depth: number }> = [];
    const { document } = parseHTML(html);

    document.querySelectorAll("a[href]").forEach((anchor: Element) => {
      const rawHref = anchor.getAttribute("href");
      if (!rawHref) return;

      const href = rawHref.trim();
      if (!href) return;

      // Skip fragment-only links
      if (href.startsWith("#")) return;

      // Skip non-HTTP schemes
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

      // Strip hash fragments
      try {
        const parsed = new URL(resolved);
        parsed.hash = "";
        resolved = parsed.toString();
      } catch {
        return;
      }

      // Same domain only
      if (!isSameDomain(resolved, this.options.url)) return;

      // Content pages only
      if (!isContentUrl(resolved)) return;

      // Include/exclude patterns
      if (!shouldIncludeUrl(resolved, this.options.includePatterns, this.options.excludePatterns))
        return;

      // Robots.txt
      if (!isUrlAllowed(resolved, this.robotsRules)) return;

      // Deduplication
      const urlKey = getUrlKey(resolved);
      if (this.visited.has(urlKey) || this.queue.some((q) => getUrlKey(q.url) === urlKey)) {
        return;
      }

      links.push({ url: resolved, depth });
    });

    return links;
  }

  /**
   * Scrape all discovered URLs for content.
   */
  private async scrapeDiscoveredUrls(): Promise<ScrapeResult> {
    const urls = this.urls.map((u) => u.url);

    return scrape({
      urls,
      formats: this.options.formats || ["markdown", "html"],
      batchConcurrency: this.options.scrapeConcurrency || 2,
      proxy: this.options.proxy,
      proxyTier: this.options.proxyTier,
      userAgent: this.options.userAgent,
      verbose: this.options.verbose,
      showChrome: this.options.showChrome,
      pool: this.options.pool,
      tieredPool: this.options.tieredPool,
      proxyGate: this.options.proxyGate,
      healthTracker: this.options.healthTracker,
      resolveProxy: this.options.resolveProxy,
      removeAds: this.options.removeAds,
      removeBase64Images: this.options.removeBase64Images,
    });
  }
}

/**
 * Convenience function to crawl a website
 */
export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const crawler = new Crawler(options);
  return crawler.crawl();
}
