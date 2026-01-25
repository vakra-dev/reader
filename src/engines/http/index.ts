/**
 * HTTP Engine - Native fetch
 *
 * Fastest engine, no browser overhead.
 * Works for ~60-70% of static sites.
 * Falls back to tlsclient/hero when blocked or challenged.
 */

import type { Engine, EngineConfig, EngineMeta, EngineResult } from "../types.js";
import {
  EngineError,
  ChallengeDetectedError,
  InsufficientContentError,
  HttpError,
  EngineTimeoutError,
} from "../errors.js";
import { ENGINE_CONFIGS } from "../types.js";

/**
 * Browser-like headers for fetch requests
 */
const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

/**
 * Challenge indicators in HTML content
 * These patterns suggest the page requires JS execution or is blocked
 */
const CHALLENGE_PATTERNS = [
  // Cloudflare
  "cf-browser-verification",
  "cf_chl_opt",
  "challenge-platform",
  "cf-spinner",
  "Just a moment",
  "Checking your browser",
  "checking if the site connection is secure",
  "Enable JavaScript and cookies",
  "Attention Required",
  "_cf_chl_tk",
  "Verifying you are human",
  "cf-turnstile",
  "/cdn-cgi/challenge-platform/",

  // Generic bot detection
  "Please Wait...",
  "DDoS protection by",
  "Access denied",
  "bot detection",
  "are you a robot",
  "complete the security check",
];

/**
 * Patterns indicating Cloudflare infrastructure
 */
const CLOUDFLARE_INFRA_PATTERNS = ["/cdn-cgi/", "cloudflare", "__cf_bm", "cf-ray"];

/**
 * Minimum content length threshold (characters)
 */
const MIN_CONTENT_LENGTH = 100;

/**
 * HTTP Engine implementation using native fetch
 */
export class HttpEngine implements Engine {
  readonly config: EngineConfig = ENGINE_CONFIGS.http;

  async scrape(meta: EngineMeta): Promise<EngineResult> {
    const startTime = Date.now();
    const { url, options, logger, abortSignal } = meta;

    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.maxTimeout);

      // Link external abort signal
      if (abortSignal) {
        abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
      }

      logger?.debug(`[http] Fetching ${url}`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          ...DEFAULT_HEADERS,
          ...(options.headers || {}),
        },
        redirect: "follow",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const duration = Date.now() - startTime;
      const html = await response.text();

      logger?.debug(`[http] Got response: ${response.status} (${html.length} chars) in ${duration}ms`);

      // Check for HTTP errors
      if (response.status >= 400) {
        throw new HttpError("http", response.status, response.statusText);
      }

      // Check for challenge pages
      const challengeType = this.detectChallenge(html);
      if (challengeType) {
        logger?.debug(`[http] Challenge detected: ${challengeType}`);
        throw new ChallengeDetectedError("http", challengeType);
      }

      // Check for sufficient content
      const textContent = this.extractText(html);
      if (textContent.length < MIN_CONTENT_LENGTH) {
        logger?.debug(`[http] Insufficient content: ${textContent.length} chars`);
        throw new InsufficientContentError("http", textContent.length, MIN_CONTENT_LENGTH);
      }

      return {
        html,
        url: response.url,
        statusCode: response.status,
        contentType: response.headers.get("content-type") || undefined,
        headers: this.headersToRecord(response.headers),
        engine: "http",
        duration,
      };
    } catch (error: unknown) {
      // Re-throw our own errors
      if (
        error instanceof ChallengeDetectedError ||
        error instanceof InsufficientContentError ||
        error instanceof HttpError
      ) {
        throw error;
      }

      // Handle abort/timeout
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new EngineTimeoutError("http", this.config.maxTimeout);
        }

        // Wrap other errors
        throw new EngineError("http", error.message, { cause: error });
      }

      throw new EngineError("http", String(error));
    }
  }

  /**
   * Detect challenge patterns in HTML
   * @returns Challenge type or null if no challenge detected
   */
  private detectChallenge(html: string): string | null {
    const htmlLower = html.toLowerCase();

    // Check for Cloudflare infrastructure + challenge patterns
    const hasCloudflare = CLOUDFLARE_INFRA_PATTERNS.some((p) => htmlLower.includes(p.toLowerCase()));

    for (const pattern of CHALLENGE_PATTERNS) {
      if (htmlLower.includes(pattern.toLowerCase())) {
        if (hasCloudflare || pattern.includes("cf")) {
          return "cloudflare";
        }
        return "bot-detection";
      }
    }

    return null;
  }

  /**
   * Convert Headers to Record<string, string>
   */
  private headersToRecord(headers: Headers): Record<string, string> {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }

  /**
   * Extract visible text from HTML (rough extraction)
   */
  private extractText(html: string): string {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  isAvailable(): boolean {
    return true; // Native fetch is always available in Node.js 18+
  }
}

/**
 * Singleton instance
 */
export const httpEngine = new HttpEngine();
