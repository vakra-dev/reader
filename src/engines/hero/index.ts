/**
 * Hero Engine - Full browser with JavaScript execution
 *
 * Uses Hero browser automation with a tiered browser pool. Each proxy
 * gets its own long-lived Hero instance (Chrome process); scrapes run
 * in fresh tabs that are opened and closed per request.
 *
 * Pool selection:
 *   - Prefers `options.tieredPool` (TieredBrowserPool) when present.
 *     Looks up the browser bound to `options.proxy?.url` and runs the
 *     scrape through `ProxyBoundBrowser.withPage`.
 *   - Falls back to `options.pool` (legacy IBrowserPool.withBrowser) so
 *     the crawler and any other remaining legacy caller keeps working.
 */

import Hero from "@ulixee/hero";
import type { Engine, EngineConfig, EngineMeta, EngineResult } from "../types.js";
import {
  EngineError,
  InsufficientContentError,
  EngineTimeoutError,
  EngineUnavailableError,
} from "../errors.js";
import { ENGINE_CONFIG } from "../types.js";
import type { IBrowserPool } from "../../browser/types.js";
import type { TieredBrowserPool, PoolTier } from "../../browser/tiered-pool.js";
import { redactProxyUrl } from "../../browser/proxy-bound-browser.js";

/**
 * Minimum content length threshold
 */
const MIN_CONTENT_LENGTH = 100;

/**
 * Hero Engine implementation using browser pool
 */
export class HeroEngine implements Engine {
  readonly config: EngineConfig = ENGINE_CONFIG;

  async scrape(meta: EngineMeta): Promise<EngineResult> {
    const startTime = Date.now();
    const { url, options, logger, abortSignal } = meta;

    const tieredPool = options.tieredPool as TieredBrowserPool | undefined;
    const legacyPool = options.pool as IBrowserPool | undefined;
    if (!tieredPool && !legacyPool) {
      throw new EngineUnavailableError("hero", "Browser pool not available");
    }

    if (abortSignal?.aborted) {
      throw new EngineTimeoutError("hero", 0);
    }

    const proxyUrl = options.proxy?.url ?? null;
    logger?.debug(`[hero] Starting browser scrape of ${url} (proxy: ${redactProxyUrl(proxyUrl)})`);

    // Runner: drives Hero/Tab to extract HTML. Both Hero and Tab expose
    // the same navigation surface (goto, document, waitForLoad, etc.).
    const runScrape = async (heroOrTab: any): Promise<EngineResult> => {
      let aborted = false;
      if (abortSignal) {
        abortSignal.addEventListener(
          "abort",
          () => {
            aborted = true;
          },
          { once: true }
        );
      }

      const timeoutMs = options.timeoutMs || this.config.maxTimeout;
      await heroOrTab.goto(url, { timeoutMs });

      if (aborted) {
        throw new EngineTimeoutError("hero", Date.now() - startTime);
      }

      try {
        await heroOrTab.waitForLoad("DomContentLoaded", { timeoutMs });
      } catch {
        // Timeout is OK, continue anyway
      }
      await heroOrTab.waitForPaintingStable();

      if (aborted) {
        throw new EngineTimeoutError("hero", Date.now() - startTime);
      }

      // Wait for selector if specified
      if (options.waitForSelector) {
        try {
          await heroOrTab.waitForElement(
            heroOrTab.document.querySelector(options.waitForSelector),
            {
              timeoutMs,
            }
          );
        } catch {
          logger?.debug(`[hero] Selector not found: ${options.waitForSelector}`);
        }
      }

      // Extract content
      const html = await heroOrTab.document.documentElement.outerHTML;
      const finalUrl = await heroOrTab.url;

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
        statusCode: 200,
        engine: "hero" as const,
        duration,
      };
    };

    try {
      let result: EngineResult;

      if (tieredPool) {
        const bound = tieredPool.getBrowserByProxy(proxyUrl);
        if (bound && bound.isAvailable()) {
          await bound.ready;
          result = await bound.withPage(async (tab) => runScrape(tab));
        } else {
          const tier = resolveTierFromOptions(options.proxyTier);
          if (!tieredPool.hasTier(tier)) {
            throw new EngineUnavailableError(
              "hero",
              `no browser bound to ${redactProxyUrl(proxyUrl)} and tier "${tier}" has no browsers`
            );
          }
          const lease = tieredPool.acquire(tier);
          await lease.browser.ready;
          result = await lease.browser.withPage(async (tab) => runScrape(tab));
        }
      } else {
        result = await legacyPool!.withBrowser(async (hero: Hero) => runScrape(hero));
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
        if (error.name === "TimeoutError" || error.message.includes("timeout")) {
          throw new EngineTimeoutError("hero", this.config.maxTimeout);
        }

        if (error.message.includes("Navigation") || error.message.includes("ERR_")) {
          throw new EngineError("hero", `Navigation failed: ${error.message}`, { cause: error });
        }

        throw new EngineError("hero", error.message, { cause: error });
      }

      throw new EngineError("hero", String(error));
    }
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
export const heroEngine = new HeroEngine();

/**
 * Map a ScrapeOptions.proxyTier to a TieredBrowserPool PoolTier.
 */
function resolveTierFromOptions(proxyTier: string | undefined): PoolTier {
  if (proxyTier === "residential") return "residential";
  if (proxyTier === "direct") return "direct";
  return "datacenter";
}
