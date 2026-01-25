/**
 * Engine-specific error classes
 *
 * These errors are used internally by engines and the orchestrator
 * to signal specific failure conditions and control flow.
 */

import type { EngineName } from "./types.js";

/**
 * Base error for all engine errors
 */
export class EngineError extends Error {
  readonly engine: EngineName;
  readonly retryable: boolean;

  constructor(engine: EngineName, message: string, options?: { cause?: Error; retryable?: boolean }) {
    super(`[${engine}] ${message}`);
    this.name = "EngineError";
    this.engine = engine;
    this.retryable = options?.retryable ?? true;
    this.cause = options?.cause;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Challenge detected (Cloudflare, CAPTCHA, etc.)
 * Signals orchestrator to try next engine
 */
export class ChallengeDetectedError extends EngineError {
  readonly challengeType: string;

  constructor(engine: EngineName, challengeType?: string) {
    super(engine, `Challenge detected: ${challengeType || "unknown"}`, { retryable: true });
    this.name = "ChallengeDetectedError";
    this.challengeType = challengeType || "unknown";
  }
}

/**
 * Content too short or empty
 * May indicate blocked page or JS-required content
 */
export class InsufficientContentError extends EngineError {
  readonly contentLength: number;
  readonly threshold: number;

  constructor(engine: EngineName, contentLength: number, threshold: number = 100) {
    super(engine, `Insufficient content: ${contentLength} chars (threshold: ${threshold})`, { retryable: true });
    this.name = "InsufficientContentError";
    this.contentLength = contentLength;
    this.threshold = threshold;
  }
}

/**
 * HTTP error status (4xx, 5xx)
 */
export class HttpError extends EngineError {
  readonly statusCode: number;

  constructor(engine: EngineName, statusCode: number, statusText?: string) {
    const retryable = statusCode >= 500 || statusCode === 429;
    super(engine, `HTTP ${statusCode}${statusText ? `: ${statusText}` : ""}`, { retryable });
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

/**
 * Engine timeout
 */
export class EngineTimeoutError extends EngineError {
  readonly timeoutMs: number;

  constructor(engine: EngineName, timeoutMs: number) {
    super(engine, `Timeout after ${timeoutMs}ms`, { retryable: true });
    this.name = "EngineTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Engine not available (not configured, missing dependency)
 */
export class EngineUnavailableError extends EngineError {
  constructor(engine: EngineName, reason?: string) {
    super(engine, reason || "Engine not available", { retryable: false });
    this.name = "EngineUnavailableError";
  }
}

/**
 * Signal to orchestrator to move to next engine
 * Not a real error - used for control flow
 */
export class NextEngineSignal extends Error {
  readonly fromEngine: EngineName;
  readonly reason: string;

  constructor(fromEngine: EngineName, reason: string) {
    super(`Next engine signal from ${fromEngine}: ${reason}`);
    this.name = "NextEngineSignal";
    this.fromEngine = fromEngine;
    this.reason = reason;
  }
}

/**
 * All engines exhausted without success
 */
export class AllEnginesFailedError extends Error {
  readonly attemptedEngines: EngineName[];
  readonly errors: Map<EngineName, Error>;

  constructor(attemptedEngines: EngineName[], errors: Map<EngineName, Error>) {
    const summary = attemptedEngines
      .map((e) => `${e}: ${errors.get(e)?.message || "unknown"}`)
      .join("; ");
    super(`All engines failed: ${summary}`);
    this.name = "AllEnginesFailedError";
    this.attemptedEngines = attemptedEngines;
    this.errors = errors;
  }
}
