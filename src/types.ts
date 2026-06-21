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
  /** IANA timezone ID matching the proxy's exit location (e.g., 'America/Los_Angeles') */
  timezoneId?: string;
}

/**
 * Proxy tier — controls which proxy pool is used
 *
 * - "datacenter": Fast, cheap datacenter IPs — works for most sites
 * - "residential": Residential/mobile IPs — needed for anti-bot sites (Amazon, LinkedIn)
 * - "auto": Start with datacenter, auto-escalate to residential on block detection
 */
export type ProxyTier = "datacenter" | "residential" | "auto";

/**
 * Multi-tier proxy pool configuration
 */
export interface ProxyPoolConfig {
  /** Datacenter proxies (fast, cheap, most sites) */
  datacenter?: ProxyConfig[];
  /** Residential proxies (slower, expensive, anti-bot sites) */
  residential?: ProxyConfig[];
}

/**
 * Proxy metadata in scrape results
 */
export interface ProxyMetadata {
  /** Proxy host that was used */
  host: string;
  /** Proxy port that was used */
  port: number;
  /** Which proxy tier was actually used */
  tier?: ProxyTier;
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

  /** Output formats - which content fields to include (default: ['markdown']) */
  formats?: Array<"markdown" | "html">;

  /** Custom user agent string (overrides Hero's default emulated UA) */
  userAgent?: string;

  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;

  // ============================================================================
  // Content cleaning options
  // ============================================================================

  /** Remove ads and tracking elements (default: true) */
  removeAds?: boolean;

  /** Remove base64-encoded images to reduce output size (default: true) */
  removeBase64Images?: boolean;

  /** Extract only main content, removing nav/header/footer/sidebar (default: true) */
  onlyMainContent?: boolean;

  /** CSS selectors for elements to include (if set, only these elements are kept) */
  includeTags?: string[];

  /** CSS selectors for elements to exclude (removed from output) */
  excludeTags?: string[];

  /**
   * Additional CSS selectors to remove when onlyMainContent is true.
   * Merged with the built-in nav/footer/sidebar selectors.
   */
  navigationSelectors?: string[];

  // ============================================================================
  // Retry & escalation options
  // ============================================================================

  /**
   * Hard deadline for a single URL in milliseconds (default: 30000).
   * After this, the scraper gives up regardless of proxy tier.
   */
  hardDeadlineMs?: number;

  /**
   * Timeout for the first attempt on datacenter proxy in milliseconds (default: 10000).
   * If no result in this time, the scraper escalates to residential.
   */
  datacenterTimeoutMs?: number;

  // ============================================================================
  // Pluggable config (injected by platform, not set by end users)
  // ============================================================================

  /**
   * Domain-specific overrides. Keyed by domain (e.g. "amazon.com").
   * Matched against the URL's hostname (www. stripped, subdomain matching).
   * Reader ships with NO built-in profiles — the caller provides them.
   */
  domainProfiles?: Record<string, import("./config/domain-profiles.js").DomainProfile>;

  /**
   * Block detection config. When provided, the scraper checks successful
   * responses for bot-block signals and escalates to residential on match.
   * Reader ships with NO built-in patterns — the caller provides them.
   */
  blockDetection?: {
    /** Regex patterns matched against page text content */
    patterns?: RegExp[];
    /** Regex patterns matched against page title */
    titlePatterns?: RegExp[];
    /** Pages shorter than this (chars) with any signal = blocked (default: 500) */
    shortContentThreshold?: number;
    /** Longer pages need this many signals to be blocked (default: 3) */
    longContentSignalThreshold?: number;
  };

  /**
   * URL rewrite rules applied before scraping. Each rule has a `match`
   * function and a `rewrite` function. Reader ships with NO built-in
   * rules — the caller provides them (e.g. Google Docs → export URL).
   */
  urlRewriters?: Array<{
    /** Name for diagnostics */
    name: string;
    /** Return true if this rewriter applies to the URL */
    match: (url: URL) => boolean;
    /** Return the rewritten URL string */
    rewrite: (url: URL) => string;
  }>;

  // ============================================================================
  // Batch processing options
  // ============================================================================

  /** Number of URLs to process in parallel (default: 1 - sequential) */
  batchConcurrency?: number;

  /** Total timeout for the entire batch operation in milliseconds (default: 300000) */
  batchTimeoutMs?: number;

  /** Progress callback for batch operations */
  onProgress?: (progress: { completed: number; total: number; currentUrl: string }) => void;

  // ============================================================================
  // Hero-specific options
  // ============================================================================

  /** Proxy configuration for Hero (single proxy — use proxyTier for pool-based) */
  proxy?: ProxyConfig;

  /**
   * Proxy tier selection (default: "auto")
   * - "datacenter": Use datacenter proxy pool
   * - "residential": Use residential proxy pool
   * - "auto": Start with datacenter, escalate to residential on block detection
   *
   * Requires proxyPools to be configured on ReaderClient.
   * If a single `proxy` is set, it takes precedence over pools.
   */
  proxyTier?: ProxyTier;

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

  /** Browser pool instance (internal, provided by ReaderClient, legacy single pool) */
  pool?: IBrowserPool;

  /**
   * Tiered browser pool (internal, provided by ReaderClient).
   *
   * When present, this takes precedence over `pool` for the Hero engine.
   * The Hero engine will ask the tiered pool for the browser bound to
   * `options.proxy?.url` (falling back to the tier resolved from
   * `options.proxyTier`).
   *
   * Typed as `unknown` to avoid a type cycle between types.ts and
   * browser/tiered-pool.ts.
   */
  tieredPool?: unknown;

  /**
   * Playwright browser pool (internal, provided by ReaderClient).
   *
   * When present, the Playwright engine uses this pool for browser pages.
   * Typed as `unknown` to avoid a type cycle.
   */
  playwrightPool?: unknown;

  /**
   * Per-proxy concurrency gate (internal, provided by ReaderClient).
   *
   * When present, the scraper wraps the entire engine waterfall in
   * `proxyGate.withSlot(proxyUrl, ...)`, ensuring at most N simultaneous
   * scrapes go through any single proxy URL at a time. All three engines
   * share the slot because they race in parallel through the same proxy.
   *
   * Typed as `unknown` to avoid a type cycle.
   */
  proxyGate?: unknown;

  /**
   * Per-proxy health tracker (internal, provided by ReaderClient).
   *
   * Optional. When present, the scraper records success/failure after each
   * attempt. The tracker emits bench/revive events that the TieredBrowserPool
   * listens to; the scraper itself just reports outcomes.
   */
  healthTracker?: unknown;

  /**
   * Callback that resolves a proxy URL for a given tier.
   *
   * Provided by ReaderClient. Called per-attempt inside the scraper's
   * retry loop so domain-profile and retry-loop escalation actually swap
   * proxies between attempts (instead of just flipping a tier string in
   * options and still using the original proxy).
   *
   * Returns the proxy to use, or `undefined` for the direct lane.
   */
  resolveProxy?: (tier: ProxyTier | undefined) => ProxyConfig | undefined;
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
}

/**
 * Individual website scrape result
 */
export interface WebsiteScrapeResult {
  /** Raw HTML from the engine before cleaning (always present) */
  rawHtml: string;

  /** Markdown content (present if 'markdown' in formats) */
  markdown?: string;

  /** Cleaned HTML content (present if 'html' in formats) */
  html?: string;

  /** Metadata about the scraping operation */
  metadata: {
    /** Base URL that was scraped */
    baseUrl: string;

    /** HTTP status code from the response */
    statusCode: number;

    /** Engine that successfully scraped this URL */
    engine: string;

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
  | "proxy"
  | "proxyTier"
  | "waitForSelector"
  | "connectionToCore"
  | "userAgent"
  | "browserPool"
  | "pool"
  | "tieredPool"
  | "playwrightPool"
  | "proxyGate"
  | "healthTracker"
  | "resolveProxy"
  | "navigationSelectors"
  | "hardDeadlineMs"
  | "datacenterTimeoutMs"
  | "domainProfiles"
  | "blockDetection"
  | "urlRewriters"
> & {
  proxy?: ProxyConfig;
  proxyTier?: ProxyTier;
  waitForSelector?: string;
  connectionToCore?: any;
  userAgent?: string;
  browserPool?: BrowserPoolConfig;
  pool?: IBrowserPool;
  tieredPool?: unknown;
  playwrightPool?: unknown;
  proxyGate?: unknown;
  healthTracker?: unknown;
  resolveProxy?: (tier: ProxyTier | undefined) => ProxyConfig | undefined;
  navigationSelectors?: string[];
  hardDeadlineMs?: number;
  datacenterTimeoutMs?: number;
  domainProfiles?: Record<string, import("./config/domain-profiles.js").DomainProfile>;
  blockDetection?: ScrapeOptions["blockDetection"];
  urlRewriters?: ScrapeOptions["urlRewriters"];
} = {
  urls: [],
  formats: ["markdown"],
  timeoutMs: 30000,
  // Content cleaning defaults
  removeAds: true,
  removeBase64Images: true,
  onlyMainContent: true,
  includeTags: [],
  excludeTags: [],
  // Batch defaults
  batchConcurrency: 5,
  batchTimeoutMs: 300000,
  onProgress: () => {}, // Default no-op progress callback
  // Hero-specific defaults
  verbose: false,
  showChrome: false,
};

/**
 * Format type guard
 */
export function isValidFormat(format: string): format is "markdown" | "html" {
  return format === "markdown" || format === "html";
}

/**
 * Check if a URL should be crawled based on base domain
 */
export function shouldCrawlUrl(url: URL, baseDomain: string): boolean {
  return url.hostname === baseDomain || url.hostname.endsWith(`.${baseDomain}`);
}
