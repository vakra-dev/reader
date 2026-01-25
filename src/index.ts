/**
 * @vakra-dev/reader
 *
 * Production-grade web scraping engine with anti-bot bypass using Ulixee Hero
 * Drop-in replacement for @reader/core with superior Cloudflare bypass capabilities
 */

// =============================================================================
// Main API exports
// =============================================================================
export { ReaderClient } from "./client";
export type { ReaderClientOptions, ProxyRotation } from "./client";
export { scrape, Scraper } from "./scraper";
export { crawl, Crawler } from "./crawler";

// =============================================================================
// Daemon exports
// =============================================================================
export {
  DaemonServer,
  DaemonClient,
  isDaemonRunning,
  getDaemonInfo,
  getPidFilePath,
  DEFAULT_DAEMON_PORT,
} from "./daemon";
export type { DaemonServerOptions, DaemonClientOptions, DaemonStatus } from "./daemon";

// =============================================================================
// Type exports
// =============================================================================
export type {
  ScrapeOptions,
  ScrapeResult,
  WebsiteScrapeResult,
  BatchMetadata,
  Page,
  WebsiteMetadata,
  ProxyConfig,
  ProxyMetadata,
  BrowserPoolConfig,
} from "./types";

export type { CrawlOptions, CrawlResult, CrawlUrl, CrawlMetadata } from "./crawl-types";

// =============================================================================
// Formatter exports (for custom formatting)
// =============================================================================
export { formatToMarkdown, htmlToMarkdown } from "./formatters/markdown";
export { formatToHTML } from "./formatters/html";

// =============================================================================
// Utility exports (for advanced usage)
// =============================================================================
export { extractMetadata } from "./utils/metadata-extractor";
export { cleanContent } from "./utils/content-cleaner";
export {
  isSameDomain,
  resolveUrl,
  isValidUrl,
  validateUrls,
  getUrlKey,
  shouldCrawlUrl,
} from "./utils/url-helpers";
export { rateLimit } from "./utils/rate-limiter";

// =============================================================================
// Browser pool exports (for advanced usage)
// =============================================================================
export { BrowserPool, HeroBrowserPool } from "./browser/pool";
export { createHeroConfig } from "./browser/hero-config";
export type {
  IBrowserPool,
  PoolConfig,
  BrowserInstance,
  PoolStats,
  HealthStatus,
} from "./browser/types";

// =============================================================================
// Cloudflare exports (for advanced usage)
// =============================================================================
export { detectChallenge, isChallengePage } from "./cloudflare/detector";
export { waitForChallengeResolution, waitForSelector, handleChallenge } from "./cloudflare/handler";
export type {
  ChallengeDetection,
  ChallengeResolutionResult,
  ChallengeWaitOptions,
} from "./cloudflare/types";

// =============================================================================
// Proxy exports (for advanced usage)
// =============================================================================
export { createProxyUrl, parseProxyUrl } from "./proxy/config";

// =============================================================================
// Default options export
// =============================================================================
export { DEFAULT_OPTIONS, isValidFormat, shouldCrawlUrl as shouldCrawlUrlFn } from "./types";

// =============================================================================
// Error exports
// =============================================================================
export {
  ReaderError,
  ReaderErrorCode,
  NetworkError,
  TimeoutError,
  CloudflareError,
  AccessDeniedError,
  ContentExtractionError,
  ValidationError,
  InvalidUrlError,
  RobotsBlockedError,
  BrowserPoolError,
  ClientClosedError,
  NotInitializedError,
  wrapError,
} from "./errors";
