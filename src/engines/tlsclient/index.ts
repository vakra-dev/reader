/**
 * TLS Client Engine - got-scraping
 *
 * Uses got-scraping for browser-like TLS fingerprinting.
 * Better compatibility with sites that check TLS signatures.
 * Falls back to hero when JS execution is required.
 */

import { gotScraping } from "got-scraping";
import type { Engine, EngineConfig, EngineMeta, EngineResult } from "../types.js";
import {
  EngineError,
  ChallengeDetectedError,
  InsufficientContentError,
  HttpError,
  EngineTimeoutError,
  EngineUnavailableError,
} from "../errors.js";
import { ENGINE_CONFIGS } from "../types.js";

/**
 * Challenge indicators that require JS execution
 */
const JS_REQUIRED_PATTERNS = [
  // Cloudflare JS challenge
  "cf-browser-verification",
  "challenge-platform",
  "_cf_chl_tk",
  "/cdn-cgi/challenge-platform/",

  // Generic JS requirements
  "Enable JavaScript",
  "JavaScript is required",
  "Please enable JavaScript",
  "requires JavaScript",
  "noscript",
];

/**
 * Blocked/denied patterns
 */
const BLOCKED_PATTERNS = [
  "Access denied",
  "Sorry, you have been blocked",
  "bot detected",
  "suspicious activity",
  "too many requests",
];

/**
 * Minimum content length threshold
 */
const MIN_CONTENT_LENGTH = 100;

/**
 * TLS Client Engine implementation using got-scraping
 */
export class TlsClientEngine implements Engine {
  readonly config: EngineConfig = ENGINE_CONFIGS.tlsclient;
  private available: boolean = true;

  constructor() {
    // Check if got-scraping is properly loaded
    try {
      if (!gotScraping) {
        this.available = false;
      }
    } catch {
      this.available = false;
    }
  }

  async scrape(meta: EngineMeta): Promise<EngineResult> {
    if (!this.available) {
      throw new EngineUnavailableError("tlsclient", "got-scraping not available");
    }

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

      logger?.debug(`[tlsclient] Fetching ${url}`);

      const response = await gotScraping({
        url,
        timeout: {
          request: this.config.maxTimeout,
        },
        headers: options.headers,
        followRedirect: true,
        // got-scraping handles browser fingerprinting automatically
        // It uses header generators and proper TLS settings
      });

      clearTimeout(timeoutId);

      const duration = Date.now() - startTime;
      const html = response.body;

      logger?.debug(`[tlsclient] Got response: ${response.statusCode} (${html.length} chars) in ${duration}ms`);

      // Check for HTTP errors
      if (response.statusCode >= 400) {
        throw new HttpError("tlsclient", response.statusCode, response.statusMessage);
      }

      // Check for JS-required challenges
      const challengeType = this.detectJsRequired(html);
      if (challengeType) {
        logger?.debug(`[tlsclient] JS required: ${challengeType}`);
        throw new ChallengeDetectedError("tlsclient", challengeType);
      }

      // Check for blocked patterns
      const blockedReason = this.detectBlocked(html);
      if (blockedReason) {
        logger?.debug(`[tlsclient] Blocked: ${blockedReason}`);
        throw new ChallengeDetectedError("tlsclient", `blocked: ${blockedReason}`);
      }

      // Check for sufficient content
      const textContent = this.extractText(html);
      if (textContent.length < MIN_CONTENT_LENGTH) {
        logger?.debug(`[tlsclient] Insufficient content: ${textContent.length} chars`);
        throw new InsufficientContentError("tlsclient", textContent.length, MIN_CONTENT_LENGTH);
      }

      return {
        html,
        url: response.url,
        statusCode: response.statusCode,
        contentType: response.headers["content-type"] as string | undefined,
        headers: response.headers as Record<string, string>,
        engine: "tlsclient",
        duration,
      };
    } catch (error: unknown) {
      // Re-throw our own errors
      if (
        error instanceof ChallengeDetectedError ||
        error instanceof InsufficientContentError ||
        error instanceof HttpError ||
        error instanceof EngineUnavailableError
      ) {
        throw error;
      }

      // Handle timeout
      if (error instanceof Error) {
        if (error.name === "TimeoutError" || error.message.includes("timeout")) {
          throw new EngineTimeoutError("tlsclient", this.config.maxTimeout);
        }

        if (error.name === "AbortError") {
          throw new EngineTimeoutError("tlsclient", this.config.maxTimeout);
        }

        // Wrap other errors
        throw new EngineError("tlsclient", error.message, { cause: error });
      }

      throw new EngineError("tlsclient", String(error));
    }
  }

  /**
   * Detect patterns that require JS execution
   */
  private detectJsRequired(html: string): string | null {
    const htmlLower = html.toLowerCase();

    for (const pattern of JS_REQUIRED_PATTERNS) {
      if (htmlLower.includes(pattern.toLowerCase())) {
        if (pattern.includes("cf") || pattern.includes("cloudflare")) {
          return "cloudflare-js";
        }
        return "js-required";
      }
    }

    return null;
  }

  /**
   * Detect blocked/denied patterns
   */
  private detectBlocked(html: string): string | null {
    const htmlLower = html.toLowerCase();

    for (const pattern of BLOCKED_PATTERNS) {
      if (htmlLower.includes(pattern.toLowerCase())) {
        return pattern;
      }
    }

    return null;
  }

  /**
   * Extract visible text from HTML
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
    return this.available;
  }
}

/**
 * Singleton instance
 */
export const tlsClientEngine = new TlsClientEngine();
