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

    // Race navigation against abort signal so client disconnects cancel
    // the page.goto immediately instead of waiting for the full timeout.
    const abortPromise = abortSignal
      ? new Promise<never>((_, reject) => {
          if (abortSignal.aborted) reject(new EngineTimeoutError("playwright" as EngineName, 0));
          abortSignal.addEventListener(
            "abort",
            () =>
              reject(new EngineTimeoutError("playwright" as EngineName, Date.now() - startTime)),
            { once: true }
          );
        })
      : null;

    const navigate = page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    const response = abortPromise ? await Promise.race([navigate, abortPromise]) : await navigate;

    if (abortSignal?.aborted) {
      throw new EngineTimeoutError("playwright" as EngineName, Date.now() - startTime);
    }

    // Capture SSR HTML before React/Next.js hydration runs. If hydration
    // crashes (common with Next.js apps), the error boundary replaces the
    // DOM with a generic error message. The SSR HTML is the last-known-good
    // content before that happens.
    const ssrHtml = await page.content();

    // Wait for network to settle
    try {
      await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 10000) });
    } catch {
      // networkidle timeout is OK -- some sites never fully settle
      logger?.debug("[playwright] networkidle timeout, continuing");
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

    // Extract final content (post-hydration)
    let html = await page.content();

    // If a JS framework's error boundary replaced the DOM with a generic
    // error page, fall back to the pre-hydration SSR HTML.
    if (this.isFrameworkErrorPage(html) && ssrHtml.length > html.length) {
      logger?.info("[playwright] Framework error page detected, using SSR HTML fallback");
      html = ssrHtml;
    }
    const finalUrl = page.url();
    const statusCode = response?.status() ?? 200;

    // Reject error status codes
    if (statusCode >= 400) {
      throw new EngineError("playwright" as EngineName, `HTTP ${statusCode} for ${finalUrl}`);
    }

    // Reject blank content
    const textContent = this.extractText(html);
    if (textContent.length === 0) {
      logger?.debug(`[playwright] Blank content returned for ${finalUrl}`);
      throw new InsufficientContentError("playwright" as EngineName, 0, 1);
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

  /**
   * Detect known JS framework error boundary pages that replace real content.
   */
  private isFrameworkErrorPage(html: string): boolean {
    const lower = html.toLowerCase();
    return (
      // Next.js error boundary
      lower.includes("application error: a client-side exception has occurred") ||
      // Next.js digest error
      lower.includes("there was an error while hydrating") ||
      // Nuxt.js error page
      (lower.includes("__nuxt") && lower.includes("nuxt-error")) ||
      // Generic React error boundary
      (lower.includes("error boundary") && lower.includes("chunk") && !lower.includes("<article"))
    );
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
function resolvePoolTier(proxyTier: string | undefined): "standard" | "premium" | "direct" {
  if (proxyTier === "premium") return "premium";
  if (proxyTier === "direct") return "direct";
  return "standard";
}
