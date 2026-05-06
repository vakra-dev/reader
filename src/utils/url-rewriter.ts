/**
 * URL Rewriter
 *
 * Rewrites certain URLs to their export/download equivalents before scraping.
 * Reader ships with NO built-in rules. The caller provides rewrite rules
 * via ScrapeOptions.urlRewriters.
 */

import { createLogger } from "./logger";

const logger = createLogger("url-rewriter");

/**
 * A single URL rewrite rule.
 */
export interface UrlRewriteRule {
  /** Name for diagnostics */
  name: string;
  /** Return true if this rewriter applies to the URL */
  match: (url: URL) => boolean;
  /** Return the rewritten URL string */
  rewrite: (url: URL) => string;
}

/**
 * Result of a URL rewrite attempt.
 */
export interface RewriteResult {
  /** The final URL to scrape (rewritten or original) */
  url: string;
  /** Whether the URL was actually rewritten */
  rewritten: boolean;
  /** Reason/source of the rewrite for diagnostics */
  reason?: string;
}

/**
 * Attempt to rewrite a URL using the provided rules.
 *
 * Returns the original URL unchanged if no rule matches or no rules provided.
 */
export function rewriteUrl(inputUrl: string, rules?: UrlRewriteRule[]): RewriteResult {
  if (!rules || rules.length === 0) {
    return { url: inputUrl, rewritten: false };
  }

  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    return { url: inputUrl, rewritten: false };
  }

  for (const rule of rules) {
    if (rule.match(parsed)) {
      const rewritten = rule.rewrite(parsed);
      logger.debug(`[url-rewriter] Rewrote (${rule.name}): ${inputUrl} -> ${rewritten}`);
      return { url: rewritten, rewritten: true, reason: rule.name };
    }
  }

  return { url: inputUrl, rewritten: false };
}
