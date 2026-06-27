/**
 * @vakra-dev/reader
 *
 * Production-grade web scraping engine for LLMs.
 * Clean markdown output, ready for your agents.
 */

// =============================================================================
// Main API exports
// =============================================================================
export { ReaderClient } from "./client";
export type { ReaderClientOptions, ProxyRotation } from "./client";
export { scrape, Scraper } from "./scraper";
export { crawl, Crawler } from "./crawler";
export { createBrowserSession } from "./browser-session";
export type { BrowserOptions, BrowserSession } from "./browser-types";

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
  ProxyPoolConfig,
  ProxyTier,
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
// Proxy exports (for advanced usage)
// =============================================================================
export { createProxyUrl, parseProxyUrl, redactProxyUrl } from "./proxy/config";

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
  DNSError,
  TLSError,
  BotDetectedError,
  ProxyConnectionError,
  ProxyExhaustedError,
  ContentTooLargeError,
  MarkdownConversionError,
  EmptyContentError,
  wrapError,
} from "./errors";

// Engine errors
export { ScrapeFailedError } from "./engines/errors";

// =============================================================================
// Block detection exports
// =============================================================================
export { detectBotPage, detectBotTitle, isBlockedResponse } from "./utils/block-detector";
export type { BlockDetectionConfig } from "./utils/block-detector";

// =============================================================================
// URL rewriter exports
// =============================================================================
export { rewriteUrl } from "./utils/url-rewriter";
export type { UrlRewriteRule, RewriteResult } from "./utils/url-rewriter";

// =============================================================================
// Domain profiles exports
// =============================================================================
export { getDomainProfile, applyDomainProfile } from "./config/domain-profiles";
export type { DomainProfile } from "./config/domain-profiles";
