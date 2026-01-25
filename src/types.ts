import type { IBrowserPool } from "./browser/types";

/**
 * Proxy configuration for Hero
 */
export interface ProxyConfig {
  /** Full proxy URL (takes precedence over other fields) */
  url?: string;
  /** Proxy type */
  type?: "datacenter" | "residential";
  /** Proxy username */
  username?: string;
  /** Proxy password */
  password?: string;
  /** Proxy host */
  host?: string;
  /** Proxy port */
  port?: number;
  /** Country code for residential proxies (e.g., 'us', 'uk') */
  country?: string;
}

/**
 * Proxy metadata in scrape results
 */
export interface ProxyMetadata {
  /** Proxy host that was used */
  host: string;
  /** Proxy port that was used */
  port: number;
  /** Country code if geo-targeting was used */
  country?: string;
}

/**
 * Browser pool configuration for ReaderClient
 */
export interface BrowserPoolConfig {
  /** Number of browser instances (default: 2) */
  size?: number;
  /** Retire browser after this many page loads (default: 100) */
  retireAfterPages?: number;
  /** Retire browser after this many minutes (default: 30) */
  retireAfterMinutes?: number;
  /** Maximum pending requests in queue (default: 100) */
  maxQueueSize?: number;
}

/**
 * Main scraping options interface
 */
export interface ScrapeOptions {
  /** Array of URLs to scrape */
  urls: string[];

  /** Output formats (default: ['markdown']) */
  formats?: Array<"markdown" | "html" | "json" | "text">;

  /** Include URL, title, timestamp (default: true) */
  includeMetadata?: boolean;

  /** Custom user agent string */
  userAgent?: string;

  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;

  /** URL patterns to include (regex strings) */
  includePatterns?: string[];

  /** URL patterns to exclude (regex strings) */
  excludePatterns?: string[];

  // ============================================================================
  // Content cleaning options
  // ============================================================================

  /** Remove ads and tracking elements (default: true) */
  removeAds?: boolean;

  /** Remove base64-encoded images to reduce output size (default: true) */
  removeBase64Images?: boolean;

  /** Skip TLS/SSL certificate verification (default: true) */
  skipTLSVerification?: boolean;

  // ============================================================================
  // Batch processing options
  // ============================================================================

  /** Number of URLs to process in parallel (default: 1 - sequential) */
  batchConcurrency?: number;

  /** Total timeout for the entire batch operation in milliseconds (default: 300000) */
  batchTimeoutMs?: number;

  /** Maximum retry attempts for failed URLs (default: 2) */
  maxRetries?: number;

  /** Progress callback for batch operations */
  onProgress?: (progress: { completed: number; total: number; currentUrl: string }) => void;

  // ============================================================================
  // Hero-specific options
  // ============================================================================

  /** Proxy configuration for Hero */
  proxy?: ProxyConfig;

  /** CSS selector to wait for before considering page loaded */
  waitForSelector?: string;

  /** Enable verbose logging (default: false) */
  verbose?: boolean;

  /** Show Chrome window (default: false) */
  showChrome?: boolean;

  /** Connection to Hero Core (for shared Core usage) */
  connectionToCore?: any;

  /** Browser pool configuration (passed from ReaderClient) */
  browserPool?: BrowserPoolConfig;

  /** Browser pool instance (internal, provided by ReaderClient) */
  pool?: IBrowserPool;
}

/**
 * Website metadata extracted from the base page
 */
export interface WebsiteMetadata {
  /** Basic meta tags */
  title: string | null /** <title> or <meta property="og:title"> */;
  description: string | null /** <meta name="description"> */;
  author: string | null /** <meta name="author"> */;
  language: string | null /** <html lang="..."> */;
  charset: string | null /** <meta charset="..."> */;

  /** Links */
  favicon: string | null /** <link rel="icon"> */;
  image: string | null /** <meta property="og:image"> */;
  canonical: string | null /** <link rel="canonical"> */;

  /** SEO */
  keywords: string[] | null /** <meta name="keywords"> */;
  robots: string | null /** <meta name="robots"> */;

  /** Branding */
  themeColor: string | null /** <meta name="theme-color"> */;

  /** Open Graph */
  openGraph: {
    title: string | null /** <meta property="og:title"> */;
    description: string | null /** <meta property="og:description"> */;
    type: string | null /** <meta property="og:type"> */;
    url: string | null /** <meta property="og:url"> */;
    image: string | null /** <meta property="og:image"> */;
    siteName: string | null /** <meta property="og:site_name"> */;
    locale: string | null /** <meta property="og:locale"> */;
  } | null;

  /** Twitter Card */
  twitter: {
    card: string | null /** <meta name="twitter:card"> */;
    site: string | null /** <meta name="twitter:site"> */;
    creator: string | null /** <meta name="twitter:creator"> */;
    title: string | null /** <meta name="twitter:title"> */;
    description: string | null /** <meta name="twitter:description"> */;
    image: string | null /** <meta name="twitter:image"> */;
  } | null;
}

/**
 * Individual page data
 */
export interface Page {
  /** Full URL of the page */
  url: string;

  /** Page title */
  title: string;

  /** Markdown content */
  markdown: string;

  /** HTML content */
  html: string;

  /** When the page was fetched */
  fetchedAt: string;

  /** Crawl depth from base URL */
  depth: number;

  // ============================================================================
  // Hero-specific fields
  // ============================================================================

  /** Whether a Cloudflare challenge was detected */
  hadChallenge?: boolean;

  /** Type of challenge encountered */
  challengeType?: string;

  /** Time spent waiting for challenge resolution (ms) */
  waitTimeMs?: number;
}

/**
 * Individual website scrape result (for backward compatibility)
 */
export interface WebsiteScrapeResult {
  /** Markdown output (present if 'markdown' in formats) */
  markdown?: string;

  /** HTML output (present if 'html' in formats) */
  html?: string;

  /** JSON output (present if 'json' in formats) */
  json?: string;

  /** Plain text output (present if 'text' in formats) */
  text?: string;

  /** Metadata about the scraping operation */
  metadata: {
    /** Base URL that was scraped */
    baseUrl: string;

    /** Total number of pages scraped */
    totalPages: number;

    /** ISO timestamp when scraping started */
    scrapedAt: string;

    /** Duration in milliseconds */
    duration: number;

    /** Website metadata extracted from base page */
    website: WebsiteMetadata;

    /** Proxy used for this request (if proxy pooling was enabled) */
    proxy?: ProxyMetadata;
  };
}

/**
 * Batch metadata for multi-URL operations
 */
export interface BatchMetadata {
  /** Total number of URLs provided */
  totalUrls: number;

  /** Number of URLs successfully scraped */
  successfulUrls: number;

  /** Number of URLs that failed */
  failedUrls: number;

  /** ISO timestamp when the batch operation started */
  scrapedAt: string;

  /** Total duration for the entire batch in milliseconds */
  totalDuration: number;

  /** Array of errors for failed URLs */
  errors?: Array<{ url: string; error: string }>;
}

/**
 * Main scrape result interface
 */
export interface ScrapeResult {
  /** Array of individual website results */
  data: WebsiteScrapeResult[];

  /** Metadata about the batch operation */
  batchMetadata: BatchMetadata;
}

/**
 * Internal crawler state
 */
export interface CrawlerState {
  /** Set of visited URLs to avoid duplicates */
  visited: Set<string>;

  /** Queue of URLs to process */
  queue: Array<{ url: string; depth: number }>;

  /** Completed pages */
  pages: Page[];
}

/**
 * Internal scraper configuration
 */
export interface ScraperConfig {
  /** Merged options with defaults */
  options: Required<ScrapeOptions>;

  /** Parsed base URL */
  baseUrl: URL;

  /** Base domain for same-origin checking */
  baseDomain: string;
}

/**
 * Default scrape options
 */
export const DEFAULT_OPTIONS: Omit<
  Required<ScrapeOptions>,
  "proxy" | "waitForSelector" | "connectionToCore" | "userAgent" | "browserPool" | "pool"
> & {
  proxy?: ProxyConfig;
  waitForSelector?: string;
  connectionToCore?: any;
  userAgent?: string;
  browserPool?: BrowserPoolConfig;
  pool?: IBrowserPool;
} = {
  urls: [],
  formats: ["markdown"],
  includeMetadata: true,
  timeoutMs: 30000,
  includePatterns: [],
  excludePatterns: [],
  // Content cleaning defaults
  removeAds: true,
  removeBase64Images: true,
  skipTLSVerification: true,
  // Batch defaults
  batchConcurrency: 1,
  batchTimeoutMs: 300000,
  maxRetries: 2,
  onProgress: () => {}, // Default no-op progress callback
  // Hero-specific defaults
  verbose: false,
  showChrome: false,
};

/**
 * Format type guard
 */
export function isValidFormat(format: string): format is "markdown" | "html" | "json" | "text" {
  return format === "markdown" || format === "html" || format === "json" || format === "text";
}

/**
 * Check if a URL should be crawled based on base domain
 */
export function shouldCrawlUrl(url: URL, baseDomain: string): boolean {
  return url.hostname === baseDomain || url.hostname.endsWith(`.${baseDomain}`);
}
