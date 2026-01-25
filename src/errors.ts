/**
 * Typed error classes for Reader
 *
 * Provides actionable error messages and structured error information
 * for better debugging and error handling.
 */

/**
 * Error codes for categorization
 */
export enum ReaderErrorCode {
  // Network errors
  NETWORK_ERROR = "NETWORK_ERROR",
  TIMEOUT = "TIMEOUT",
  CONNECTION_REFUSED = "CONNECTION_REFUSED",

  // Cloudflare/bot detection
  CLOUDFLARE_CHALLENGE = "CLOUDFLARE_CHALLENGE",
  BOT_DETECTED = "BOT_DETECTED",
  ACCESS_DENIED = "ACCESS_DENIED",

  // Content errors
  CONTENT_EXTRACTION_FAILED = "CONTENT_EXTRACTION_FAILED",
  EMPTY_CONTENT = "EMPTY_CONTENT",

  // Validation errors
  INVALID_URL = "INVALID_URL",
  INVALID_OPTIONS = "INVALID_OPTIONS",

  // Robots.txt
  ROBOTS_BLOCKED = "ROBOTS_BLOCKED",

  // Browser/pool errors
  BROWSER_ERROR = "BROWSER_ERROR",
  POOL_EXHAUSTED = "POOL_EXHAUSTED",

  // Client errors
  CLIENT_CLOSED = "CLIENT_CLOSED",
  NOT_INITIALIZED = "NOT_INITIALIZED",

  // Unknown
  UNKNOWN = "UNKNOWN",
}

/**
 * Base error class for all Reader errors
 */
export class ReaderError extends Error {
  readonly code: ReaderErrorCode;
  readonly url?: string;
  readonly cause?: Error;
  readonly timestamp: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    code: ReaderErrorCode,
    options?: {
      url?: string;
      cause?: Error;
      retryable?: boolean;
    }
  ) {
    super(message);
    this.name = "ReaderError";
    this.code = code;
    this.url = options?.url;
    this.cause = options?.cause;
    this.timestamp = new Date().toISOString();
    this.retryable = options?.retryable ?? false;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert to a plain object for serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      url: this.url,
      timestamp: this.timestamp,
      retryable: this.retryable,
      cause: this.cause?.message,
      stack: this.stack,
    };
  }
}

/**
 * Network-related errors (connection issues, DNS failures, etc.)
 */
export class NetworkError extends ReaderError {
  constructor(message: string, options?: { url?: string; cause?: Error }) {
    super(message, ReaderErrorCode.NETWORK_ERROR, {
      ...options,
      retryable: true,
    });
    this.name = "NetworkError";
  }
}

/**
 * Timeout errors (page load, navigation, etc.)
 */
export class TimeoutError extends ReaderError {
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number, options?: { url?: string; cause?: Error }) {
    super(message, ReaderErrorCode.TIMEOUT, {
      ...options,
      retryable: true,
    });
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      timeoutMs: this.timeoutMs,
    };
  }
}

/**
 * Cloudflare challenge errors
 */
export class CloudflareError extends ReaderError {
  readonly challengeType: string;

  constructor(challengeType: string, options?: { url?: string; cause?: Error }) {
    super(
      `Cloudflare ${challengeType} challenge not resolved. Consider using a residential proxy or increasing timeout.`,
      ReaderErrorCode.CLOUDFLARE_CHALLENGE,
      {
        ...options,
        retryable: true,
      }
    );
    this.name = "CloudflareError";
    this.challengeType = challengeType;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      challengeType: this.challengeType,
    };
  }
}

/**
 * Access denied errors (blocked, forbidden, etc.)
 */
export class AccessDeniedError extends ReaderError {
  readonly statusCode?: number;

  constructor(message: string, options?: { url?: string; statusCode?: number; cause?: Error }) {
    super(message, ReaderErrorCode.ACCESS_DENIED, {
      ...options,
      retryable: false,
    });
    this.name = "AccessDeniedError";
    this.statusCode = options?.statusCode;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      statusCode: this.statusCode,
    };
  }
}

/**
 * Content extraction errors
 */
export class ContentExtractionError extends ReaderError {
  constructor(message: string, options?: { url?: string; cause?: Error }) {
    super(message, ReaderErrorCode.CONTENT_EXTRACTION_FAILED, {
      ...options,
      retryable: false,
    });
    this.name = "ContentExtractionError";
  }
}

/**
 * Validation errors (invalid URLs, options, etc.)
 */
export class ValidationError extends ReaderError {
  readonly field?: string;

  constructor(message: string, options?: { field?: string; url?: string }) {
    super(message, ReaderErrorCode.INVALID_OPTIONS, {
      url: options?.url,
      retryable: false,
    });
    this.name = "ValidationError";
    this.field = options?.field;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      field: this.field,
    };
  }
}

/**
 * URL validation error
 */
export class InvalidUrlError extends ReaderError {
  constructor(url: string, reason?: string) {
    super(reason ? `Invalid URL "${url}": ${reason}` : `Invalid URL: ${url}`, ReaderErrorCode.INVALID_URL, {
      url,
      retryable: false,
    });
    this.name = "InvalidUrlError";
  }
}

/**
 * Robots.txt blocked error
 */
export class RobotsBlockedError extends ReaderError {
  constructor(url: string) {
    super(`URL blocked by robots.txt: ${url}. Set respectRobotsTxt: false to override.`, ReaderErrorCode.ROBOTS_BLOCKED, {
      url,
      retryable: false,
    });
    this.name = "RobotsBlockedError";
  }
}

/**
 * Browser pool errors
 */
export class BrowserPoolError extends ReaderError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, ReaderErrorCode.BROWSER_ERROR, {
      ...options,
      retryable: true,
    });
    this.name = "BrowserPoolError";
  }
}

/**
 * Client state errors
 */
export class ClientClosedError extends ReaderError {
  constructor() {
    super("ReaderClient has been closed. Create a new instance to continue.", ReaderErrorCode.CLIENT_CLOSED, {
      retryable: false,
    });
    this.name = "ClientClosedError";
  }
}

/**
 * Not initialized error
 */
export class NotInitializedError extends ReaderError {
  constructor(component: string) {
    super(`${component} not initialized. This should not happen - please report this bug.`, ReaderErrorCode.NOT_INITIALIZED, {
      retryable: false,
    });
    this.name = "NotInitializedError";
  }
}

/**
 * Helper to wrap unknown errors in ReaderError
 */
export function wrapError(error: unknown, url?: string): ReaderError {
  if (error instanceof ReaderError) {
    return error;
  }

  if (error instanceof Error) {
    // Check for common error patterns
    const message = error.message.toLowerCase();

    if (message.includes("timeout") || message.includes("timed out")) {
      return new TimeoutError(error.message, 30000, { url, cause: error });
    }

    if (message.includes("econnrefused") || message.includes("connection refused")) {
      return new NetworkError(`Connection refused: ${error.message}`, { url, cause: error });
    }

    if (message.includes("enotfound") || message.includes("dns")) {
      return new NetworkError(`DNS lookup failed: ${error.message}`, { url, cause: error });
    }

    if (message.includes("cloudflare") || message.includes("challenge")) {
      return new CloudflareError("unknown", { url, cause: error });
    }

    return new ReaderError(error.message, ReaderErrorCode.UNKNOWN, {
      url,
      cause: error,
      retryable: false,
    });
  }

  return new ReaderError(String(error), ReaderErrorCode.UNKNOWN, {
    url,
    retryable: false,
  });
}
