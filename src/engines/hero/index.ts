/**
 * Hero Engine - Full browser with JavaScript execution
 *
 * Uses Hero browser automation with browser pool.
 * Handles JavaScript-heavy sites and challenge pages.
 * Most capable but slowest engine - used as fallback.
 */

import Hero from "@ulixee/hero";
import type { Engine, EngineConfig, EngineMeta, EngineResult } from "../types.js";
import {
  EngineError,
  ChallengeDetectedError,
  InsufficientContentError,
  EngineTimeoutError,
  EngineUnavailableError,
} from "../errors.js";
import { ENGINE_CONFIGS } from "../types.js";
import { detectChallenge } from "../../cloudflare/detector.js";
import { waitForChallengeResolution } from "../../cloudflare/handler.js";
import type { IBrowserPool } from "../../browser/types.js";

/**
 * Minimum content length threshold
 */
const MIN_CONTENT_LENGTH = 100;

/**
 * Hero Engine implementation using browser pool
 */
export class HeroEngine implements Engine {
  readonly config: EngineConfig = ENGINE_CONFIGS.hero;

  async scrape(meta: EngineMeta): Promise<EngineResult> {
    const startTime = Date.now();
    const { url, options, logger, abortSignal } = meta;

    // Get browser pool from options
    const pool = options.pool as IBrowserPool | undefined;
    if (!pool) {
      throw new EngineUnavailableError("hero", "Browser pool not available");
    }

    // Check for abort before starting
    if (abortSignal?.aborted) {
      throw new EngineTimeoutError("hero", 0);
    }

    logger?.debug(`[hero] Starting browser scrape of ${url}`);

    try {
      const result = await pool.withBrowser(async (hero: Hero) => {
        // Set up abort handling
        let aborted = false;
        if (abortSignal) {
          abortSignal.addEventListener("abort", () => {
            aborted = true;
          }, { once: true });
        }

        // Navigate to URL
        const timeoutMs = options.timeoutMs || this.config.maxTimeout;
        await hero.goto(url, { timeoutMs });

        if (aborted) {
          throw new EngineTimeoutError("hero", Date.now() - startTime);
        }

        // Wait for initial page load
        try {
          await hero.waitForLoad("DomContentLoaded", { timeoutMs });
        } catch {
          // Timeout is OK, continue anyway
        }
        await hero.waitForPaintingStable();

        if (aborted) {
          throw new EngineTimeoutError("hero", Date.now() - startTime);
        }

        // Detect and handle Cloudflare challenge
        const initialUrl = await hero.url;
        const detection = await detectChallenge(hero);

        if (detection.isChallenge) {
          logger?.debug(`[hero] Challenge detected: ${detection.type}`);

          // If it's a blocked challenge, we can't proceed
          if (detection.type === "blocked") {
            throw new ChallengeDetectedError("hero", "blocked");
          }

          // Wait for resolution
          const resolution = await waitForChallengeResolution(hero, {
            maxWaitMs: 45000,
            pollIntervalMs: 500,
            verbose: options.verbose,
            initialUrl,
          });

          if (!resolution.resolved) {
            throw new ChallengeDetectedError("hero", `unresolved: ${detection.type}`);
          }

          logger?.debug(`[hero] Challenge resolved via ${resolution.method} in ${resolution.waitedMs}ms`);
        }

        if (aborted) {
          throw new EngineTimeoutError("hero", Date.now() - startTime);
        }

        // Wait for final page to stabilize (handles Cloudflare silent redirects)
        await this.waitForFinalPage(hero, url, logger);

        if (aborted) {
          throw new EngineTimeoutError("hero", Date.now() - startTime);
        }

        // Wait for selector if specified
        if (options.waitForSelector) {
          try {
            await hero.waitForElement(hero.document.querySelector(options.waitForSelector), {
              timeoutMs,
            });
          } catch {
            logger?.debug(`[hero] Selector not found: ${options.waitForSelector}`);
          }
        }

        // Extract content
        const html = await hero.document.documentElement.outerHTML;
        const finalUrl = await hero.url;

        // Validate content length
        const textContent = this.extractText(html);
        if (textContent.length < MIN_CONTENT_LENGTH) {
          logger?.debug(`[hero] Insufficient content: ${textContent.length} chars`);
          throw new InsufficientContentError("hero", textContent.length, MIN_CONTENT_LENGTH);
        }

        const duration = Date.now() - startTime;
        logger?.debug(`[hero] Success: ${html.length} chars in ${duration}ms`);

        return {
          html,
          url: finalUrl,
          statusCode: 200, // Hero doesn't expose status code directly
          engine: "hero" as const,
          duration,
        };
      });

      return result;
    } catch (error: unknown) {
      // Re-throw our own errors
      if (
        error instanceof ChallengeDetectedError ||
        error instanceof InsufficientContentError ||
        error instanceof EngineTimeoutError ||
        error instanceof EngineUnavailableError
      ) {
        throw error;
      }

      // Handle specific error types
      if (error instanceof Error) {
        // Timeout errors
        if (error.name === "TimeoutError" || error.message.includes("timeout")) {
          throw new EngineTimeoutError("hero", this.config.maxTimeout);
        }

        // Navigation errors
        if (error.message.includes("Navigation") || error.message.includes("ERR_")) {
          throw new EngineError("hero", `Navigation failed: ${error.message}`, { cause: error });
        }

        // Wrap other errors
        throw new EngineError("hero", error.message, { cause: error });
      }

      throw new EngineError("hero", String(error));
    }
  }

  /**
   * Wait for the final page to load after any Cloudflare redirects
   */
  private async waitForFinalPage(hero: Hero, originalUrl: string, logger?: EngineMeta["logger"]): Promise<void> {
    const maxWaitMs = 15000;
    const startTime = Date.now();

    // Wait for any pending navigation to complete
    try {
      await hero.waitForLoad("AllContentLoaded", { timeoutMs: maxWaitMs });
    } catch {
      // Timeout is OK
    }

    // Check if URL changed (Cloudflare redirect)
    let currentUrl = await hero.url;
    const normalizeUrl = (url: string) => url.replace(/\/+$/, "");
    const urlChanged = normalizeUrl(currentUrl) !== normalizeUrl(originalUrl);

    if (urlChanged || currentUrl.includes("__cf_chl")) {
      logger?.debug(`[hero] Cloudflare redirect detected: ${originalUrl} → ${currentUrl}`);

      // Wait for the redirect to complete and new page to load
      let lastUrl = currentUrl;
      let stableCount = 0;

      while (Date.now() - startTime < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, 500));

        try {
          currentUrl = await hero.url;

          // URL is stable if it hasn't changed for 2 consecutive checks
          if (currentUrl === lastUrl) {
            stableCount++;
            if (stableCount >= 2) {
              break;
            }
          } else {
            stableCount = 0;
            lastUrl = currentUrl;
            logger?.debug(`[hero] URL changed to: ${currentUrl}`);
          }
        } catch {
          // Error getting URL, continue waiting
        }
      }

      // Final wait for page content to render
      try {
        await hero.waitForLoad("AllContentLoaded", { timeoutMs: 10000 });
      } catch {
        // Timeout OK
      }
    }

    // Final stabilization
    await hero.waitForPaintingStable();

    // Buffer for JS execution and dynamic content loading
    await new Promise((resolve) => setTimeout(resolve, 2000));
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
    // Hero is always available if we can import it
    // Actual pool availability is checked in scrape()
    return true;
  }
}

/**
 * Singleton instance
 */
export const heroEngine = new HeroEngine();
