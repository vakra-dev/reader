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
  DNS_ERROR = "DNS_ERROR",
  TLS_ERROR = "TLS_ERROR",

  // Cloudflare/bot detection
  CLOUDFLARE_CHALLENGE = "CLOUDFLARE_CHALLENGE",
  BOT_DETECTED = "BOT_DETECTED",
  ACCESS_DENIED = "ACCESS_DENIED",

  // Proxy errors
  PROXY_CONNECTION_ERROR = "PROXY_CONNECTION_ERROR",
  PROXY_EXHAUSTED = "PROXY_EXHAUSTED",

  // Content errors
  CONTENT_EXTRACTION_FAILED = "CONTENT_EXTRACTION_FAILED",
  EMPTY_CONTENT = "EMPTY_CONTENT",
  CONTENT_TOO_LARGE = "CONTENT_TOO_LARGE",
  MARKDOWN_CONVERSION_FAILED = "MARKDOWN_CONVERSION_FAILED",

  // Engine errors
  ALL_ENGINES_FAILED = "ALL_ENGINES_FAILED",

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
    super(
      reason ? `Invalid URL "${url}": ${reason}` : `Invalid URL: ${url}`,
      ReaderErrorCode.INVALID_URL,
      {
        url,
        retryable: false,
      }
    );
    this.name = "InvalidUrlError";
  }
}

/**
 * Robots.txt blocked error
 */
export class RobotsBlockedError extends ReaderError {
  constructor(url: string) {
    super(
      `URL blocked by robots.txt: ${url}. Set respectRobotsTxt: false to override.`,
      ReaderErrorCode.ROBOTS_BLOCKED,
      {
        url,
        retryable: false,
      }
    );
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
    super(
      "ReaderClient has been closed. Create a new instance to continue.",
      ReaderErrorCode.CLIENT_CLOSED,
      {
        retryable: false,
      }
    );
    this.name = "ClientClosedError";
  }
}

/**
 * Not initialized error
 */
export class NotInitializedError extends ReaderError {
  constructor(component: string) {
    super(
      `${component} not initialized. This should not happen - please report this bug.`,
      ReaderErrorCode.NOT_INITIALIZED,
      {
        retryable: false,
      }
    );
    this.name = "NotInitializedError";
  }
}

// ============================================================================
// DNS/TLS errors
// ============================================================================

/**
 * DNS resolution failure
 */
export class DNSError extends ReaderError {
  readonly hostname: string;

  constructor(hostname: string, options?: { url?: string; cause?: Error }) {
    super(`Cannot resolve hostname: ${hostname}`, ReaderErrorCode.DNS_ERROR, {
      ...options,
      retryable: false,
    });
    this.name = "DNSError";
    this.hostname = hostname;
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), hostname: this.hostname };
  }
}

/**
 * TLS/SSL handshake failure
 */
export class TLSError extends ReaderError {
  constructor(detail: string, options?: { url?: string; cause?: Error }) {
    super(`TLS handshake failed: ${detail}`, ReaderErrorCode.TLS_ERROR, {
      ...options,
      retryable: true,
    });
    this.name = "TLSError";
  }
}

// ============================================================================
// Bot detection errors
// ============================================================================

/**
 * Bot detection triggered (distinct from Cloudflare — covers Amazon, etc.)
 */
export class BotDetectedError extends ReaderError {
  readonly signal: string;

  constructor(signal: string, options?: { url?: string; cause?: Error }) {
    super(`Bot detection triggered: ${signal}`, ReaderErrorCode.BOT_DETECTED, {
      ...options,
      retryable: true,
    });
    this.name = "BotDetectedError";
    this.signal = signal;
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), signal: this.signal };
  }
}

// ============================================================================
// Proxy errors
// ============================================================================

/**
 * Proxy connection failed
 */
export class ProxyConnectionError extends ReaderError {
  readonly proxyTier: string;

  constructor(proxyTier: string, options?: { url?: string; cause?: Error }) {
    super(`Proxy connection failed (${proxyTier})`, ReaderErrorCode.PROXY_CONNECTION_ERROR, {
      ...options,
      retryable: true,
    });
    this.name = "ProxyConnectionError";
    this.proxyTier = proxyTier;
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), proxyTier: this.proxyTier };
  }
}

/**
 * All proxy tiers exhausted
 */
export class ProxyExhaustedError extends ReaderError {
  constructor(options?: { url?: string; cause?: Error }) {
    super(
      "All proxy tiers exhausted — unable to reach the target",
      ReaderErrorCode.PROXY_EXHAUSTED,
      {
        ...options,
        retryable: false,
      }
    );
    this.name = "ProxyExhaustedError";
  }
}

// ============================================================================
// Content errors
// ============================================================================

/**
 * Content too large for processing
 */
export class ContentTooLargeError extends ReaderError {
  readonly sizeBytes: number;
  readonly limitBytes: number;

  constructor(sizeBytes: number, limitBytes: number, options?: { url?: string }) {
    super(
      `HTML content (${sizeBytes} bytes) exceeds processing limit (${limitBytes} bytes)`,
      ReaderErrorCode.CONTENT_TOO_LARGE,
      { ...options, retryable: false }
    );
    this.name = "ContentTooLargeError";
    this.sizeBytes = sizeBytes;
    this.limitBytes = limitBytes;
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), sizeBytes: this.sizeBytes, limitBytes: this.limitBytes };
  }
}

/**
 * Markdown conversion failed (e.g., supermarkdown panic caught)
 */
export class MarkdownConversionError extends ReaderError {
  constructor(detail: string, options?: { url?: string; cause?: Error }) {
    super(`Markdown conversion failed: ${detail}`, ReaderErrorCode.MARKDOWN_CONVERSION_FAILED, {
      ...options,
      retryable: false,
    });
    this.name = "MarkdownConversionError";
  }
}

/**
 * Content is empty or insufficient
 */
export class EmptyContentError extends ReaderError {
  readonly contentLength: number;

  constructor(contentLength: number, options?: { url?: string }) {
    super(
      `Content too short (${contentLength} chars) — page may require JavaScript rendering or may be bot-blocked`,
      ReaderErrorCode.EMPTY_CONTENT,
      { ...options, retryable: true }
    );
    this.name = "EmptyContentError";
    this.contentLength = contentLength;
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), contentLength: this.contentLength };
  }
}

// ============================================================================
// Engine/retry errors
// ============================================================================

// Note: ScrapeFailedError is defined in src/engines/errors.ts.
// Re-exported from src/engines/index.ts for consumers.

// ============================================================================
// Utility
// ============================================================================

/**
 * Helper to wrap unknown errors in ReaderError
 */
export function wrapError(error: unknown, url?: string): ReaderError {
  if (error instanceof ReaderError) {
    return error;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Proxy patterns (check before timeout — "tunnel timeout" is a proxy error)
    if (message.includes("proxy") || (message.includes("tunnel") && !message.includes("timeout"))) {
      return new ProxyConnectionError("unknown", { url, cause: error });
    }

    // Timeout patterns
    if (
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("etimedout")
    ) {
      // Check if this is actually a proxy tunnel timeout
      if (message.includes("tunnel")) {
        return new ProxyConnectionError("unknown", { url, cause: error });
      }
      return new TimeoutError(error.message, 30000, { url, cause: error });
    }

    // DNS patterns
    if (message.includes("enotfound") || message.includes("getaddrinfo")) {
      const hostname = url ? new URL(url).hostname : "unknown";
      return new DNSError(hostname, { url, cause: error });
    }

    // TLS/SSL patterns
    if (
      message.includes("ssl") ||
      message.includes("certificate") ||
      message.includes("cert_") ||
      message.includes("unable to verify") ||
      message.includes("self signed") ||
      message.includes("err_tls")
    ) {
      return new TLSError(error.message, { url, cause: error });
    }

    // Connection patterns
    if (message.includes("econnrefused") || message.includes("connection refused")) {
      return new NetworkError(`Connection refused: ${error.message}`, { url, cause: error });
    }

    if (
      message.includes("econnreset") ||
      message.includes("socket hang up") ||
      message.includes("err_connection_reset") ||
      message.includes("err_connection_closed")
    ) {
      return new NetworkError(`Connection reset: ${error.message}`, { url, cause: error });
    }

    // Too many redirects
    if (
      message.includes("too many redirects") ||
      message.includes("err_too_many_redirects") ||
      message.includes("maxredirects")
    ) {
      return new NetworkError(`Too many redirects for ${url ?? "URL"}`, { url, cause: error });
    }

    // Empty response
    if (message.includes("err_empty_response") || message.includes("empty response")) {
      return new NetworkError(`Server returned empty response`, { url, cause: error });
    }

    // HTTP/2 protocol errors
    if (message.includes("err_http2_protocol_error") || message.includes("http2 protocol")) {
      return new NetworkError(`HTTP/2 protocol error: ${error.message}`, { url, cause: error });
    }

    // Client blocking patterns (ad blockers, extensions, etc.)
    if (message.includes("err_blocked_by_client") || message.includes("blocked by client")) {
      return new NetworkError(`Request blocked by client`, { url, cause: error });
    }

    // Proxy patterns
    if (message.includes("proxy") || message.includes("tunnel")) {
      return new ProxyConnectionError("unknown", { url, cause: error });
    }

    // Cloudflare patterns
    if (message.includes("cloudflare") || message.includes("challenge")) {
      return new CloudflareError("unknown", { url, cause: error });
    }

    // Markdown conversion patterns (supermarkdown panics caught by NAPI)
    if (
      message.includes("supermarkdown") ||
      message.includes("conversion failed") ||
      message.includes("formatting argument")
    ) {
      return new MarkdownConversionError(error.message, { url, cause: error });
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
