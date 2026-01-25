/**
 * Multi-Engine Scraping System
 *
 * Provides a cascading engine architecture for web scraping:
 *   1. http - Native fetch, fastest, works for static sites
 *   2. tlsclient - TLS fingerprinting via got-scraping
 *   3. hero - Full browser with JavaScript execution
 *
 * The orchestrator manages fallback between engines automatically.
 *
 * @example
 * import { createOrchestrator } from './engines';
 *
 * const orchestrator = createOrchestrator({ verbose: true });
 * const result = await orchestrator.scrape({
 *   url: 'https://example.com',
 *   options: { pool }
 * });
 * console.log(`Scraped with ${result.engine} in ${result.duration}ms`);
 */

// Types
export type {
  EngineName,
  Engine,
  EngineConfig,
  EngineFeatures,
  EngineMeta,
  EngineResult,
} from "./types.js";

export { ENGINE_CONFIGS, DEFAULT_ENGINE_ORDER } from "./types.js";

// Errors
export {
  EngineError,
  ChallengeDetectedError,
  InsufficientContentError,
  HttpError,
  EngineTimeoutError,
  EngineUnavailableError,
  NextEngineSignal,
  AllEnginesFailedError,
} from "./errors.js";

// Individual engines
export { httpEngine, HttpEngine } from "./http/index.js";
export { tlsClientEngine, TlsClientEngine } from "./tlsclient/index.js";
export { heroEngine, HeroEngine } from "./hero/index.js";

// Orchestrator
export {
  EngineOrchestrator,
  createOrchestrator,
  orchestratedScrape,
  type OrchestratorOptions,
  type OrchestratorResult,
} from "./orchestrator.js";
