/**
 * Engine error classes
 *
 * Used by the Hero engine and orchestrator to signal specific failure
 * conditions. Consumed by the scraper's retry/escalation logic.
 */

import type { EngineName } from "./types.js";

/**
 * Base error for all engine errors
 */
export class EngineError extends Error {
  readonly engine: EngineName;
  readonly retryable: boolean;

  constructor(
    engine: EngineName,
    message: string,
    options?: { cause?: Error; retryable?: boolean }
  ) {
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
 * Content too short or empty
 */
export class InsufficientContentError extends EngineError {
  readonly contentLength: number;
  readonly threshold: number;

  constructor(engine: EngineName, contentLength: number, threshold: number = 100) {
    super(engine, `Insufficient content: ${contentLength} chars (threshold: ${threshold})`, {
      retryable: true,
    });
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
 * Page is blocked (challenge page, access denied, bot detection).
 * Retryable by default -- triggers proxy tier escalation in the scraper.
 */
export class EngineBlockedError extends EngineError {
  readonly blockReason: string;

  constructor(engine: EngineName, blockReason: string) {
    super(engine, `Blocked: ${blockReason}`, { retryable: true });
    this.name = "EngineBlockedError";
    this.blockReason = blockReason;
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
 * Engine failed — wraps the underlying error with proxy block signals.
 *
 * The scraper uses `proxyBlock` to decide whether to escalate to a
 * stronger proxy tier.
 */
export class ScrapeFailedError extends Error {
  /** True when the failure is a proxy-level block (HTTP 401/403/429, redirect loop) */
  readonly proxyBlock: boolean;

  constructor(error: Error, options?: { proxyBlock?: boolean }) {
    super(error.message);
    this.name = "ScrapeFailedError";
    this.cause = error;
    this.proxyBlock = options?.proxyBlock ?? false;
  }
}
