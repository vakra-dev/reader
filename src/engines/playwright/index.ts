/**
 * Playwright Engine — full browser scraping via CDP, no MITM.
 *
 * Replaces HeroEngine. Uses PlaywrightPool to get Chrome pages, then
 * navigates, waits for content, and extracts HTML. Same Engine interface,
 * same EngineResult shape — everything above the engine layer is unchanged.
 *
 * Key difference from Hero: load detection uses CDP protocol directly
 * (waitUntil: "domcontentloaded", waitForLoadState("networkidle")),
 * not MITM traffic interception. This means Cloudflare challenges can
 * resolve naturally since there's no proxy intercepting TLS.
 */

import type { Engine, EngineConfig, EngineMeta, EngineResult, EngineName } from "../types.js";
import {
  EngineError,
  InsufficientContentError,
  EngineTimeoutError,
  EngineUnavailableError,
} from "../errors.js";
import type { PlaywrightPool } from "../../browser/playwright-pool.js";

const MIN_CONTENT_LENGTH = 100;

/**
 * Playwright engine configuration
 */
export const PLAYWRIGHT_ENGINE_CONFIG: EngineConfig = {
  name: "playwright" as EngineName,
  timeout: 10000,
  maxTimeout: 30000,
  features: {
    javascript: true,
    cloudflare: true,
    tlsFingerprint: false, // No MITM = no TLS fingerprint spoofing, but also no MITM interference
    waitFor: true,
    screenshots: true,
  },
};

/**
 * Playwright Engine implementation
 */
export class PlaywrightEngine implements Engine {
  readonly config: EngineConfig = PLAYWRIGHT_ENGINE_CONFIG;

  async scrape(meta: EngineMeta): Promise<EngineResult> {
    const startTime = Date.now();
    const { url, options, logger, abortSignal } = meta;

    const pool = options.playwrightPool as PlaywrightPool | undefined;
    if (!pool) {
      throw new EngineUnavailableError("playwright" as EngineName, "Playwright pool not available");
    }

    if (abortSignal?.aborted) {
      throw new EngineTimeoutError("playwright" as EngineName, 0);
    }

    const proxyUrl = options.proxy?.url ?? null;
    logger?.debug(`[playwright] Starting scrape of ${url}`);

    try {
      // Find the Chrome instance for this proxy
      const bound = pool.getBrowserByProxy(proxyUrl);
      let result: EngineResult;

      if (bound && bound.isAvailable()) {
        await bound.ready;
        result = await bound.withPage(async (page) => {
          return await this.runScrape(page, url, options, startTime, logger, abortSignal);
        });
      } else {
        // Fall back to tier-based acquisition
        const tier = resolvePoolTier(options.proxyTier);
        if (!pool.hasTier(tier)) {
          throw new EngineUnavailableError(
            "playwright" as EngineName,
            `no browser for proxy and tier "${tier}" has no browsers`
          );
        }
        const lease = pool.acquire(tier);
        await lease.browser.ready;
        result = await lease.browser.withPage(async (page) => {
          return await this.runScrape(page, url, options, startTime, logger, abortSignal);
        });
      }

      return result;
    } catch (error: unknown) {
      if (
        error instanceof InsufficientContentError ||
        error instanceof EngineTimeoutError ||
        error instanceof EngineUnavailableError
      ) {
        throw error;
      }

      if (error instanceof Error) {
        if (
          error.name === "TimeoutError" ||
          error.message.includes("timeout") ||
          error.message.includes("Timeout")
        ) {
          throw new EngineTimeoutError("playwright" as EngineName, this.config.maxTimeout);
        }

        if (error.message.includes("net::ERR_") || error.message.includes("Navigation")) {
          throw new EngineError("playwright" as EngineName, `Navigation failed: ${error.message}`, {
            cause: error,
          });
        }

        throw new EngineError("playwright" as EngineName, error.message, { cause: error });
      }

      throw new EngineError("playwright" as EngineName, String(error));
    }
  }

  private async runScrape(
    page: import("playwright-core").Page,
    url: string,
    options: EngineMeta["options"],
    startTime: number,
    logger?: import("../../utils/logger.js").Logger,
    abortSignal?: AbortSignal
  ): Promise<EngineResult> {
    const timeoutMs = options.timeoutMs || this.config.maxTimeout;

    // Navigate with domcontentloaded (fast, doesn't depend on all resources)
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    if (abortSignal?.aborted) {
      throw new EngineTimeoutError("playwright" as EngineName, Date.now() - startTime);
    }

    // Wait for network to settle — equivalent to Hero's waitForPaintingStable
    try {
      await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 10000) });
    } catch {
      // networkidle timeout is OK — some sites never fully settle
      logger?.debug("[playwright] networkidle timeout, continuing");
    }

    if (abortSignal?.aborted) {
      throw new EngineTimeoutError("playwright" as EngineName, Date.now() - startTime);
    }

    // Detect Cloudflare challenge and wait for it to resolve.
    // Cloudflare Turnstile/managed challenges load JS that auto-solves and
    // redirects. With the stealth plugin active, Turnstile typically resolves
    // in 10-30s. We give it up to the remaining time from the engine timeout.
    const title = await page.title();
    if (title === "Just a moment..." || title === "Attention Required! | Cloudflare") {
      logger?.debug("[playwright] Cloudflare challenge detected, waiting for resolution...");
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(timeoutMs - elapsed, 5000);
      try {
        // Wait for the page title to change away from the challenge page
        await page.waitForFunction(
          () =>
            document.title !== "Just a moment..." &&
            document.title !== "Attention Required! | Cloudflare",
          { timeout: remaining }
        );
        // After challenge resolves, wait for the real page to settle
        try {
          await page.waitForLoadState("networkidle", { timeout: 10000 });
        } catch {
          // OK if networkidle times out
        }
        logger?.debug(
          `[playwright] Cloudflare challenge resolved, new title: ${await page.title()}`
        );
      } catch {
        logger?.debug("[playwright] Cloudflare challenge did not resolve in time");
      }
    }

    if (abortSignal?.aborted) {
      throw new EngineTimeoutError("playwright" as EngineName, Date.now() - startTime);
    }

    // Wait for selector if specified
    if (options.waitForSelector) {
      try {
        await page.waitForSelector(options.waitForSelector, {
          timeout: Math.min(timeoutMs, 10000),
        });
      } catch {
        logger?.debug(`[playwright] Selector not found: ${options.waitForSelector}`);
      }
    }

    // Extract content
    const html = await page.content();
    const finalUrl = page.url();
    const statusCode = response?.status() ?? 200;

    // Validate content length
    const textContent = this.extractText(html);
    if (textContent.length < MIN_CONTENT_LENGTH) {
      logger?.debug(`[playwright] Insufficient content: ${textContent.length} chars`);
      throw new InsufficientContentError(
        "playwright" as EngineName,
        textContent.length,
        MIN_CONTENT_LENGTH
      );
    }

    // Capture screenshot if requested (must happen before page closes)
    let screenshot: string | undefined;
    if (options.formats?.includes("screenshot")) {
      const buffer = await page.screenshot({ type: "png", fullPage: true });
      screenshot = buffer.toString("base64");
      logger?.debug(`[playwright] Screenshot captured: ${buffer.length} bytes`);
    }

    const duration = Date.now() - startTime;
    logger?.debug(`[playwright] Success: ${html.length} chars in ${duration}ms`);

    return {
      html,
      url: finalUrl,
      statusCode,
      screenshot,
      engine: "playwright" as EngineName,
      duration,
    };
  }

  private extractText(html: string): string {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  isAvailable(): boolean {
    return true;
  }
}

/**
 * Singleton instance
 */
export const playwrightEngine = new PlaywrightEngine();

/**
 * Map proxy tier to pool tier.
 */
function resolvePoolTier(proxyTier: string | undefined): "datacenter" | "residential" | "direct" {
  if (proxyTier === "residential") return "residential";
  if (proxyTier === "direct") return "direct";
  return "datacenter";
}
