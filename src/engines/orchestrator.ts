/**
 * Engine Orchestrator
 *
 * Runs the scraping engine against a URL, applies a minimal quality check,
 * and returns the result. Detects proxy-level blocks (HTTP 401/403/429,
 * redirect loops) so the scraper's retry loop can escalate to a stronger proxy.
 *
 * Uses Playwright engine by default. Hero engine is retained for fallback.
 */

import type { EngineMeta, EngineResult } from "./types.js";
import { ScrapeFailedError, HttpError, EngineUnavailableError } from "./errors.js";
import { playwrightEngine } from "./playwright/index.js";
import type { Logger } from "../utils/logger.js";

/**
 * Orchestrator options
 */
export interface OrchestratorOptions {
  /** Logger instance */
  logger?: Logger;
  /** Verbose logging */
  verbose?: boolean;
}

/**
 * Orchestrator result with scrape metadata
 */
export interface OrchestratorResult extends EngineResult {
  /** Whether the response was detected as a block page */
  blocked: boolean;
}

/**
 * Engine Orchestrator
 *
 * @example
 * const orchestrator = new EngineOrchestrator({ verbose: true });
 * const result = await orchestrator.scrape({
 *   url: 'https://example.com',
 *   options: { timeoutMs: 30000 }
 * });
 */
export class EngineOrchestrator {
  private options: OrchestratorOptions;

  constructor(options: OrchestratorOptions = {}) {
    this.options = options;
  }

  /**
   * Assess result quality. Intentionally minimal — if there's any text
   * content, it's a pass. Block detection is a proxy concern, not ours.
   */
  private assessQuality(result: EngineResult): {
    passed: boolean;
    reason?: "empty_content" | "http_error";
  } {
    const statusOk =
      (result.statusCode >= 200 && result.statusCode < 300) || result.statusCode === 304;

    const textContent =
      result.html
        ?.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim() ?? "";

    const hasContent = textContent.length > 0;

    if (!statusOk && !hasContent) return { passed: false, reason: "http_error" };
    if (statusOk && !hasContent) return { passed: false, reason: "empty_content" };

    return { passed: true };
  }

  /**
   * Scrape a URL using the active engine (Playwright by default).
   *
   * @throws ScrapeFailedError on failure (with proxyBlock flag for escalation)
   */
  async scrape(meta: EngineMeta): Promise<OrchestratorResult> {
    const logger = meta.logger || this.options.logger;
    const verbose = this.options.verbose || meta.options.verbose;

    const log = (msg: string) => {
      if (verbose) logger?.info(msg);
      else logger?.debug(msg);
    };

    const engine = playwrightEngine;

    if (!engine.isAvailable()) {
      throw new ScrapeFailedError(
        new EngineUnavailableError("playwright", "Playwright engine not available")
      );
    }

    log(`[orchestrator] Scraping ${meta.url} with Playwright`);

    try {
      const result = await engine.scrape(meta);

      const quality = this.assessQuality(result);
      if (!quality.passed) {
        log(`[orchestrator] Quality check failed: ${quality.reason}`);
        throw new ScrapeFailedError(new Error(`Quality check failed: ${quality.reason}`));
      }

      log(`[orchestrator] ✓ Playwright succeeded in ${result.duration}ms`);
      return { ...result, blocked: false };
    } catch (error: unknown) {
      // Already wrapped — re-throw
      if (error instanceof ScrapeFailedError) throw error;

      const err = error instanceof Error ? error : new Error(String(error));

      // Detect proxy-level blocks for escalation
      let proxyBlock = false;
      if (err instanceof HttpError && [401, 403, 429].includes(err.statusCode)) {
        proxyBlock = true;
      }
      if (err.message.includes("redirect") || err.message.includes("ERR_TOO_MANY")) {
        proxyBlock = true;
      }

      log(`[orchestrator] Hero failed: ${err.message}${proxyBlock ? " (proxy block)" : ""}`);
      throw new ScrapeFailedError(err, { proxyBlock });
    }
  }
}

/**
 * Create an orchestrator with default settings
 */
export function createOrchestrator(options: OrchestratorOptions = {}): EngineOrchestrator {
  return new EngineOrchestrator(options);
}
