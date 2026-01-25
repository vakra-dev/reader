import type { ScrapeResult, ProxyConfig } from "./types";
import type { IBrowserPool } from "./browser/types";

/**
 * Crawl options interface
 */
export interface CrawlOptions {
  /** Single seed URL to start crawling from */
  url: string;

  /** Maximum depth to crawl (default: 1) */
  depth?: number;

  /** Maximum pages to discover (default: 20) */
  maxPages?: number;

  /** Also scrape full content (default: false) */
  scrape?: boolean;

  /** Delay between requests in milliseconds (default: 1000) */
  delayMs?: number;

  /** Total timeout for the entire crawl operation in milliseconds */
  timeoutMs?: number;

  /** URL patterns to include (regex strings) - if set, only matching URLs are crawled */
  includePatterns?: string[];

  /** URL patterns to exclude (regex strings) - matching URLs are skipped */
  excludePatterns?: string[];

  // ============================================================================
  // Scrape options (used when scrape: true)
  // ============================================================================

  /** Output formats for scraped content (default: ['markdown', 'html']) */
  formats?: Array<"markdown" | "html" | "json" | "text">;

  /** Number of URLs to scrape in parallel (default: 2) */
  scrapeConcurrency?: number;

  // ============================================================================
  // Content cleaning options
  // ============================================================================

  /** Remove ads and tracking elements (default: true) */
  removeAds?: boolean;

  /** Remove base64-encoded images to reduce output size (default: true) */
  removeBase64Images?: boolean;

  // ============================================================================
  // Hero-specific options
  // ============================================================================

  /** Proxy configuration for Hero */
  proxy?: ProxyConfig;

  /** Custom user agent string */
  userAgent?: string;

  /** Enable verbose logging (default: false) */
  verbose?: boolean;

  /** Show Chrome window (default: false) */
  showChrome?: boolean;

  /** Connection to Hero Core (for shared Core usage) */
  connectionToCore?: any;

  /** Browser pool instance (internal, provided by ReaderClient) */
  pool?: IBrowserPool;
}

/**
 * Crawl URL result interface
 */
export interface CrawlUrl {
  /** URL of the page */
  url: string;

  /** Page title */
  title: string;

  /** Page description or null if not found */
  description: string | null;
}

/**
 * Crawl result interface
 */
export interface CrawlResult {
  /** Array of discovered URLs with basic info */
  urls: CrawlUrl[];

  /** Full scrape results (only when scrape: true) */
  scraped?: ScrapeResult;

  /** Crawl operation metadata */
  metadata: CrawlMetadata;
}

/**
 * Crawl metadata interface
 */
export interface CrawlMetadata {
  /** Total URLs discovered */
  totalUrls: number;

  /** Maximum depth reached */
  maxDepth: number;

  /** Total crawl duration in milliseconds */
  totalDuration: number;

  /** Seed URL that started the crawl */
  seedUrl: string;
}
