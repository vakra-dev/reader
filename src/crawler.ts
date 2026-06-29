import pLimit from "p-limit";
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
import { createLogger } from "./utils/logger";
import { scrape } from "./scraper";
import type { CrawlOptions, CrawlResult, CrawlUrl, CrawlMetadata } from "./crawl-types";
import type { ScrapeResult, WebsiteScrapeResult } from "./types";

/**
 * Crawler class for discovering and scraping pages concurrently.
 *
 * BFS traversal with concurrent page fetching. Each page is scraped once
 * for both link discovery and content extraction (single pass).
 */
export class Crawler {
  private options: CrawlOptions;
  private visited: Set<string> = new Set();
  private queue: Array<{ url: string; depth: number }> = [];
  private urls: CrawlUrl[] = [];
  private scrapedPages: WebsiteScrapeResult[] = [];
  private logger = createLogger("crawler");
  private robotsRules: RobotsRules | null = null;

  constructor(options: CrawlOptions) {
    this.options = {
      depth: 1,
      maxPages: 20,
      scrape: false,
      delayMs: 200,
      formats: ["markdown", "html"],
      scrapeConcurrency: 3,
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
    const maxPages = this.options.maxPages ?? 20;
    const concurrency = this.options.scrapeConcurrency ?? 3;
    const limit = pLimit(concurrency);

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

    // BFS crawl with concurrent fetching
    while (this.queue.length > 0 && this.urls.length < maxPages) {
      if (this.options.timeoutMs && Date.now() - startTime > this.options.timeoutMs) {
        this.logger.warn(`Crawl timed out after ${this.options.timeoutMs}ms`);
        break;
      }

      // Grab a batch of items from the queue (up to concurrency limit)
      const remaining = maxPages - this.urls.length;
      const batchSize = Math.min(this.queue.length, concurrency, remaining);
      const batch: Array<{ url: string; depth: number }> = [];

      while (batch.length < batchSize && this.queue.length > 0) {
        const item = this.queue.shift()!;
        const urlKey = getUrlKey(item.url);
        if (this.visited.has(urlKey)) continue;
        this.visited.add(urlKey);
        batch.push(item);
      }

      if (batch.length === 0) break;

      // Fetch all pages in the batch concurrently
      const results = await Promise.all(
        batch.map((item) =>
          limit(async () => {
            const result = await this.fetchPage(item.url);
            return { item, result };
          })
        )
      );

      // Process results: collect URLs and extract links
      for (const { item, result } of results) {
        if (!result) continue;
        if (this.urls.length >= maxPages) break;

        this.urls.push(result.crawlUrl);

        // Store scraped content if scrape mode is on
        if (this.options.scrape && result.scraped) {
          this.scrapedPages.push(result.scraped);
        }

        // Extract links for BFS if not at max depth
        if (item.depth < (this.options.depth ?? 1)) {
          const links = this.extractLinks(result.html, item.url, item.depth + 1);
          this.queue.push(...links);
        }
      }
    }

    const metadata: CrawlMetadata = {
      totalUrls: this.urls.length,
      maxDepth: this.options.depth ?? 1,
      totalDuration: Date.now() - startTime,
      seedUrl: this.options.url,
    };

    // Build scraped result from collected pages
    let scraped: ScrapeResult | undefined;
    if (this.options.scrape && this.scrapedPages.length > 0) {
      scraped = {
        data: this.scrapedPages,
        batchMetadata: {
          totalUrls: this.scrapedPages.length,
          successfulUrls: this.scrapedPages.length,
          failedUrls: 0,
          scrapedAt: new Date().toISOString(),
          totalDuration: Date.now() - startTime,
          errors: [],
        },
      };
    }

    return {
      urls: this.urls,
      scraped,
      metadata,
    };
  }

  /**
   * Fetch a single page. Returns both discovery data (URL, title, raw HTML
   * for link extraction) and scraped content (markdown/html) in one pass.
   */
  private async fetchPage(url: string): Promise<{
    crawlUrl: CrawlUrl;
    html: string;
    scraped?: WebsiteScrapeResult;
  } | null> {
    try {
      const formats = this.options.scrape ? this.options.formats || ["markdown", "html"] : [];

      const result = await scrape({
        urls: [url],
        formats,
        onlyMainContent: this.options.scrape ? true : false,
        proxy: this.options.proxy,
        proxyTier: this.options.proxyTier,
        timeoutMs: this.options.timeoutMs,
        verbose: this.options.verbose,
        showChrome: this.options.showChrome,
        playwrightPool: this.options.playwrightPool,
        proxyGate: this.options.proxyGate,
        healthTracker: this.options.healthTracker,
        resolveProxy: this.options.resolveProxy,
        abortSignal: this.options.abortSignal,
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
        scraped: this.options.scrape ? page : undefined,
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
}

/**
 * Convenience function to crawl a website
 */
export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const crawler = new Crawler(options);
  return crawler.crawl();
}
