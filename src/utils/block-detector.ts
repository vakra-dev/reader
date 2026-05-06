/**
 * Block Detector
 *
 * Detects bot-block pages that return HTTP 200 but contain
 * anti-bot content instead of actual page content.
 *
 * Reader ships with NO built-in patterns. The caller provides
 * block detection config via ScrapeOptions.blockDetection.
 * Without config, no content-based block detection runs.
 */

/**
 * Block detection configuration — provided by the caller.
 *
 * Patterns can be RegExp objects (in-process usage) or strings
 * (serialized over HTTP/JSON — compiled to RegExp internally).
 */
export interface BlockDetectionConfig {
  /** Regex patterns matched against page text content (RegExp or string) */
  patterns?: Array<RegExp | string>;
  /** Regex patterns matched against page title (RegExp or string) */
  titlePatterns?: Array<RegExp | string>;
  /** Pages shorter than this (chars) with any signal = blocked (default: 500) */
  shortContentThreshold?: number;
  /** Longer pages need this many signals to be blocked (default: 3) */
  longContentSignalThreshold?: number;
}

/** Compile a pattern (string or RegExp) into a RegExp */
function toRegExp(p: RegExp | string): RegExp {
  return typeof p === "string" ? new RegExp(p, "i") : p;
}

/**
 * Detect if an HTML page is a bot-block/challenge page.
 *
 * Returns false if no config is provided (unopinionated default).
 */
export function detectBotPage(html: string, config?: BlockDetectionConfig): boolean {
  if (!html || html.trim().length === 0) return false;
  if (!config?.patterns || config.patterns.length === 0) return false;

  const text = stripTags(html);
  const shortThreshold = config.shortContentThreshold ?? 500;
  const longThreshold = config.longContentSignalThreshold ?? 3;

  const signalCount = config.patterns.filter((p) => toRegExp(p).test(text)).length;

  if (text.length < shortThreshold && signalCount >= 1) return true;
  if (signalCount >= longThreshold) return true;

  return false;
}

/**
 * Detect if a page title indicates a block page.
 *
 * Returns false if no config is provided.
 */
export function detectBotTitle(title: string, config?: BlockDetectionConfig): boolean {
  if (!title) return false;
  if (!config?.titlePatterns || config.titlePatterns.length === 0) return false;
  return config.titlePatterns.some((p) => toRegExp(p).test(title));
}

/**
 * Check if an HTTP response looks like a blocked response.
 *
 * HTTP-level blocks (401/403/429/503) are always detected.
 * Content-based detection (200 + bot page) only runs when
 * block detection config is provided.
 */
export function isBlockedResponse(
  statusCode: number,
  html?: string,
  config?: BlockDetectionConfig
): { blocked: boolean; reason?: string } {
  // HTTP-level blocks — always detected
  if (statusCode === 401) return { blocked: true, reason: "unauthorized" };
  if (statusCode === 403) return { blocked: true, reason: "forbidden" };
  if (statusCode === 429) return { blocked: true, reason: "rate_limited" };
  if (statusCode === 503) return { blocked: true, reason: "service_unavailable" };

  // Content-based detection — only if config provided
  if (statusCode >= 200 && statusCode < 300 && html && config) {
    if (detectBotPage(html, config)) {
      return { blocked: true, reason: "bot_page_detected" };
    }
  }

  return { blocked: false };
}

/**
 * Strip HTML tags from content for text analysis
 */
function stripTags(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
