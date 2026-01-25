/**
 * Engine Orchestrator
 *
 * Manages multi-engine scraping with waterfall fallback pattern.
 * Tries engines in order of speed/efficiency:
 *   1. http - Native fetch, fastest, works for static sites
 *   2. tlsclient - TLS fingerprinting for better compatibility
 *   3. hero - Full browser, handles Cloudflare and JS-heavy sites
 *
 * Features:
 * - Staggered timeouts (each engine gets its configured time before fallback)
 * - Parallel racing option (start next engine while previous still running)
 * - Graceful fallback on challenge detection
 * - Detailed error tracking per engine
 */

import type { Engine, EngineName, EngineMeta, EngineResult } from "./types.js";
import { DEFAULT_ENGINE_ORDER } from "./types.js";
import {
  EngineError,
  ChallengeDetectedError,
  InsufficientContentError,
  HttpError,
  EngineTimeoutError,
  EngineUnavailableError,
  AllEnginesFailedError,
} from "./errors.js";
import { httpEngine } from "./http/index.js";
import { tlsClientEngine } from "./tlsclient/index.js";
import { heroEngine } from "./hero/index.js";
import type { Logger } from "../utils/logger.js";

/**
 * Orchestrator options
 */
export interface OrchestratorOptions {
  /** Engines to use (in order). Default: ['http', 'tlsclient', 'hero'] */
  engines?: EngineName[];
  /** Skip specific engines */
  skipEngines?: EngineName[];
  /** Force a specific engine (skips others) */
  forceEngine?: EngineName;
  /** Enable parallel racing (start next engine while previous still running) */
  parallelRacing?: boolean;
  /** Logger instance */
  logger?: Logger;
  /** Verbose logging */
  verbose?: boolean;
}

/**
 * Engine registry
 */
const ENGINE_REGISTRY: Record<EngineName, Engine> = {
  http: httpEngine,
  tlsclient: tlsClientEngine,
  hero: heroEngine,
};

/**
 * Orchestrator result with engine metadata
 */
export interface OrchestratorResult extends EngineResult {
  /** Engines that were attempted */
  attemptedEngines: EngineName[];
  /** Errors from failed engines */
  engineErrors: Map<EngineName, Error>;
}

/**
 * Engine Orchestrator
 *
 * Coordinates multiple scraping engines with fallback logic.
 *
 * @example
 * const orchestrator = new EngineOrchestrator({ verbose: true });
 * const result = await orchestrator.scrape({
 *   url: 'https://example.com',
 *   options: { timeoutMs: 30000 }
 * });
 * console.log(`Scraped with ${result.engine} engine`);
 */
export class EngineOrchestrator {
  private options: OrchestratorOptions;
  private engines: Engine[];
  private engineOrder: EngineName[];

  constructor(options: OrchestratorOptions = {}) {
    this.options = options;
    this.engineOrder = this.resolveEngineOrder();
    this.engines = this.engineOrder
      .map((name) => ENGINE_REGISTRY[name])
      .filter((engine) => engine.isAvailable());
  }

  /**
   * Resolve the engine order based on options
   */
  private resolveEngineOrder(): EngineName[] {
    // If force engine is set, use only that
    if (this.options.forceEngine) {
      return [this.options.forceEngine];
    }

    // Start with configured order or default
    let order = this.options.engines || [...DEFAULT_ENGINE_ORDER];

    // Remove skipped engines
    if (this.options.skipEngines) {
      order = order.filter((e) => !this.options.skipEngines!.includes(e));
    }

    return order;
  }

  /**
   * Get available engines
   */
  getAvailableEngines(): EngineName[] {
    return this.engines.map((e) => e.config.name);
  }

  /**
   * Scrape a URL using the engine cascade
   *
   * @param meta - Engine metadata (url, options, logger, abortSignal)
   * @returns Scrape result with engine metadata
   * @throws AllEnginesFailedError if all engines fail
   */
  async scrape(meta: EngineMeta): Promise<OrchestratorResult> {
    const attemptedEngines: EngineName[] = [];
    const engineErrors = new Map<EngineName, Error>();
    const logger = meta.logger || this.options.logger;
    const verbose = this.options.verbose || meta.options.verbose;

    if (this.engines.length === 0) {
      throw new AllEnginesFailedError([], engineErrors);
    }

    const log = (msg: string) => {
      if (verbose) {
        logger?.info(msg);
      } else {
        logger?.debug(msg);
      }
    };

    log(`[orchestrator] Starting scrape of ${meta.url} with engines: ${this.engineOrder.join(" → ")}`);

    // Try each engine in order
    for (const engine of this.engines) {
      const engineName = engine.config.name;
      attemptedEngines.push(engineName);

      try {
        log(`[orchestrator] Trying ${engineName} engine...`);

        // Create abort controller for this engine's timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), engine.config.maxTimeout);

        // Link external abort signal
        if (meta.abortSignal) {
          meta.abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
        }

        try {
          const result = await engine.scrape({
            ...meta,
            abortSignal: controller.signal,
          });

          clearTimeout(timeoutId);

          log(`[orchestrator] ✓ ${engineName} succeeded in ${result.duration}ms`);

          return {
            ...result,
            attemptedEngines,
            engineErrors,
          };
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        engineErrors.set(engineName, err);

        // Log the error with appropriate detail
        if (error instanceof ChallengeDetectedError) {
          log(`[orchestrator] ${engineName} detected challenge: ${error.challengeType}`);
        } else if (error instanceof InsufficientContentError) {
          log(`[orchestrator] ${engineName} insufficient content: ${error.contentLength} chars`);
        } else if (error instanceof HttpError) {
          log(`[orchestrator] ${engineName} HTTP error: ${error.statusCode}`);
        } else if (error instanceof EngineTimeoutError) {
          log(`[orchestrator] ${engineName} timed out after ${error.timeoutMs}ms`);
        } else if (error instanceof EngineUnavailableError) {
          log(`[orchestrator] ${engineName} unavailable: ${err.message}`);
        } else {
          log(`[orchestrator] ${engineName} failed: ${err.message}`);
        }

        // Check if we should continue to next engine
        if (!this.shouldRetry(error)) {
          log(`[orchestrator] Non-retryable error, stopping cascade`);
          break;
        }

        // Continue to next engine
        log(`[orchestrator] Falling back to next engine...`);
      }
    }

    // All engines failed
    log(`[orchestrator] All engines failed for ${meta.url}`);
    throw new AllEnginesFailedError(attemptedEngines, engineErrors);
  }

  /**
   * Determine if we should retry with next engine
   */
  private shouldRetry(error: unknown): boolean {
    // Always retry on these errors
    if (
      error instanceof ChallengeDetectedError ||
      error instanceof InsufficientContentError ||
      error instanceof EngineTimeoutError
    ) {
      return true;
    }

    // Retry on HTTP errors that might be bot detection or server issues
    // 403 Forbidden - often bot detection, try better fingerprinting
    // 429 Too Many Requests - rate limited, try different engine
    // 5xx Server errors - might be blocking, try again
    if (error instanceof HttpError) {
      return error.statusCode === 403 || error.statusCode === 429 || error.statusCode >= 500;
    }

    // Don't retry on unavailable (won't help)
    if (error instanceof EngineUnavailableError) {
      return true; // Skip to next engine
    }

    // Generic engine errors - check retryable flag
    if (error instanceof EngineError) {
      return error.retryable;
    }

    // Unknown errors - retry
    return true;
  }
}

/**
 * Create an orchestrator with default settings
 */
export function createOrchestrator(options: OrchestratorOptions = {}): EngineOrchestrator {
  return new EngineOrchestrator(options);
}

/**
 * Convenience function to scrape with orchestrator
 *
 * @example
 * const result = await orchestratedScrape({
 *   url: 'https://example.com',
 *   options: { pool }
 * });
 */
export async function orchestratedScrape(
  meta: EngineMeta,
  options: OrchestratorOptions = {}
): Promise<OrchestratorResult> {
  const orchestrator = new EngineOrchestrator(options);
  return orchestrator.scrape(meta);
}
