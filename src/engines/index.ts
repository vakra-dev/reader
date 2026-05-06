/**
 * Scraping Engine
 *
 * Hero-only engine with orchestrator for quality checks and
 * proxy block detection.
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

export { ENGINE_CONFIG } from "./types.js";

// Errors
export {
  EngineError,
  InsufficientContentError,
  HttpError,
  EngineTimeoutError,
  EngineUnavailableError,
  ScrapeFailedError,
} from "./errors.js";

// Hero engine
export { heroEngine, HeroEngine } from "./hero/index.js";

// Orchestrator
export {
  EngineOrchestrator,
  createOrchestrator,
  type OrchestratorOptions,
  type OrchestratorResult,
} from "./orchestrator.js";
