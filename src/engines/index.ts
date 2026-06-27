/**
 * Scraping Engine
 *
 * Playwright engine with orchestrator for quality checks
 * and proxy block detection.
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

// Engines
export { playwrightEngine, PlaywrightEngine } from "./playwright/index.js";

// Orchestrator
export {
  EngineOrchestrator,
  createOrchestrator,
  type OrchestratorOptions,
  type OrchestratorResult,
} from "./orchestrator.js";
