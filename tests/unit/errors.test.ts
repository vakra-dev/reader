import { describe, it, expect } from "vitest";
import {
  ReaderError,
  ReaderErrorCode,
  NetworkError,
  TimeoutError,
  CloudflareError,
  AccessDeniedError,
  DNSError,
  TLSError,
  BotDetectedError,
  ProxyConnectionError,
  ProxyExhaustedError,
  ContentTooLargeError,
  MarkdownConversionError,
  EmptyContentError,
  BrowserPoolError,
  ClientClosedError,
  NotInitializedError,
  RobotsBlockedError,
  InvalidUrlError,
  wrapError,
} from "../../src/errors";
import { ScrapeFailedError } from "../../src/engines/errors";

describe("Error types", () => {
  describe("error codes", () => {
    it("NetworkError has NETWORK_ERROR code", () => {
      const err = new NetworkError("Connection failed", { url: "https://example.com" });
      expect(err.code).toBe(ReaderErrorCode.NETWORK_ERROR);
    });

    it("TimeoutError has TIMEOUT code", () => {
      const err = new TimeoutError("Timed out", 30000);
      expect(err.code).toBe(ReaderErrorCode.TIMEOUT);
      expect(err.timeoutMs).toBe(30000);
    });

    it("DNSError has DNS_ERROR code", () => {
      const err = new DNSError("nonexistent.example.com");
      expect(err.code).toBe(ReaderErrorCode.DNS_ERROR);
      expect(err.hostname).toBe("nonexistent.example.com");
    });

    it("TLSError has TLS_ERROR code", () => {
      const err = new TLSError("Certificate expired");
      expect(err.code).toBe(ReaderErrorCode.TLS_ERROR);
    });

    it("BotDetectedError has BOT_DETECTED code", () => {
      const err = new BotDetectedError("Amazon block page");
      expect(err.code).toBe(ReaderErrorCode.BOT_DETECTED);
      expect(err.signal).toBe("Amazon block page");
    });

    it("ProxyConnectionError has PROXY_CONNECTION_ERROR code", () => {
      const err = new ProxyConnectionError("datacenter");
      expect(err.code).toBe(ReaderErrorCode.PROXY_CONNECTION_ERROR);
      expect(err.proxyTier).toBe("datacenter");
    });

    it("ProxyExhaustedError has PROXY_EXHAUSTED code", () => {
      const err = new ProxyExhaustedError();
      expect(err.code).toBe(ReaderErrorCode.PROXY_EXHAUSTED);
    });

    it("ContentTooLargeError has CONTENT_TOO_LARGE code", () => {
      const err = new ContentTooLargeError(500000, 300000);
      expect(err.code).toBe(ReaderErrorCode.CONTENT_TOO_LARGE);
      expect(err.sizeBytes).toBe(500000);
      expect(err.limitBytes).toBe(300000);
    });

    it("MarkdownConversionError has MARKDOWN_CONVERSION_FAILED code", () => {
      const err = new MarkdownConversionError("Formatting argument out of range");
      expect(err.code).toBe(ReaderErrorCode.MARKDOWN_CONVERSION_FAILED);
    });

    it("EmptyContentError has EMPTY_CONTENT code", () => {
      const err = new EmptyContentError(10);
      expect(err.code).toBe(ReaderErrorCode.EMPTY_CONTENT);
      expect(err.contentLength).toBe(10);
    });

    it("ScrapeFailedError wraps underlying error with proxyBlock flag", () => {
      const inner = new Error("timeout");
      const err = new ScrapeFailedError(inner, { proxyBlock: true });
      expect(err.name).toBe("ScrapeFailedError");
      expect(err.proxyBlock).toBe(true);
      expect(err.cause).toBe(inner);
    });

  });

  describe("retryable flags", () => {
    it("NetworkError is retryable", () => {
      expect(new NetworkError("fail").retryable).toBe(true);
    });

    it("TimeoutError is retryable", () => {
      expect(new TimeoutError("timeout", 1000).retryable).toBe(true);
    });

    it("CloudflareError is retryable", () => {
      expect(new CloudflareError("turnstile").retryable).toBe(true);
    });

    it("BotDetectedError is retryable", () => {
      expect(new BotDetectedError("amazon").retryable).toBe(true);
    });

    it("ProxyConnectionError is retryable", () => {
      expect(new ProxyConnectionError("datacenter").retryable).toBe(true);
    });

    it("TLSError is retryable", () => {
      expect(new TLSError("cert expired").retryable).toBe(true);
    });

    it("EmptyContentError is retryable", () => {
      expect(new EmptyContentError(0).retryable).toBe(true);
    });

    it("BrowserPoolError is retryable", () => {
      expect(new BrowserPoolError("pool full").retryable).toBe(true);
    });

    it("AccessDeniedError is NOT retryable", () => {
      expect(new AccessDeniedError("403").retryable).toBe(false);
    });

    it("DNSError is NOT retryable", () => {
      expect(new DNSError("bad.host").retryable).toBe(false);
    });

    it("ProxyExhaustedError is NOT retryable", () => {
      expect(new ProxyExhaustedError().retryable).toBe(false);
    });

    it("ContentTooLargeError is NOT retryable", () => {
      expect(new ContentTooLargeError(1, 1).retryable).toBe(false);
    });

    it("ScrapeFailedError extends Error", () => {
      const err = new ScrapeFailedError(new Error("test"));
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("ScrapeFailedError");
    });

    it("ClientClosedError is NOT retryable", () => {
      expect(new ClientClosedError().retryable).toBe(false);
    });

    it("InvalidUrlError is NOT retryable", () => {
      expect(new InvalidUrlError("bad-url").retryable).toBe(false);
    });

    it("RobotsBlockedError is NOT retryable", () => {
      expect(new RobotsBlockedError("https://example.com/secret").retryable).toBe(false);
    });
  });

  describe("toJSON serialization", () => {
    it("serializes base ReaderError correctly", () => {
      const err = new NetworkError("Connection lost", { url: "https://example.com" });
      const json = err.toJSON();

      expect(json.name).toBe("NetworkError");
      expect(json.code).toBe("NETWORK_ERROR");
      expect(json.message).toBe("Connection lost");
      expect(json.url).toBe("https://example.com");
      expect(json.retryable).toBe(true);
      expect(json.timestamp).toBeDefined();
      expect(typeof json.timestamp).toBe("string");
      expect(json.stack).toBeDefined();
    });

    it("serializes DNSError with hostname", () => {
      const json = new DNSError("bad.host", { url: "https://bad.host" }).toJSON();
      expect(json.hostname).toBe("bad.host");
    });

    it("serializes ContentTooLargeError with sizes", () => {
      const json = new ContentTooLargeError(500000, 300000).toJSON();
      expect(json.sizeBytes).toBe(500000);
      expect(json.limitBytes).toBe(300000);
    });

    it("ScrapeFailedError preserves underlying error message", () => {
      const inner = new Error("Hero timed out after 10s");
      const err = new ScrapeFailedError(inner);
      expect(err.message).toContain("timed out");
    });

    it("serializes cause message", () => {
      const cause = new Error("root cause");
      const err = new NetworkError("wrapped", { cause });
      expect(err.toJSON().cause).toBe("root cause");
    });
  });
});

describe("wrapError", () => {
  it("passes through ReaderError unchanged", () => {
    const err = new NetworkError("test");
    expect(wrapError(err)).toBe(err);
  });

  it("wraps timeout errors", () => {
    const err = new Error("Request timed out after 30s");
    const wrapped = wrapError(err, "https://example.com");
    expect(wrapped.code).toBe(ReaderErrorCode.TIMEOUT);
    expect(wrapped.url).toBe("https://example.com");
  });

  it("wraps DNS errors (ENOTFOUND)", () => {
    const err = new Error("getaddrinfo ENOTFOUND nonexistent.example.com");
    const wrapped = wrapError(err, "https://nonexistent.example.com/page");
    expect(wrapped.code).toBe(ReaderErrorCode.DNS_ERROR);
  });

  it("wraps TLS/SSL errors", () => {
    const err = new Error("unable to verify the first certificate");
    const wrapped = wrapError(err);
    expect(wrapped.code).toBe(ReaderErrorCode.TLS_ERROR);
  });

  it("wraps connection refused errors", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:443");
    const wrapped = wrapError(err);
    expect(wrapped.code).toBe(ReaderErrorCode.NETWORK_ERROR);
  });

  it("wraps connection reset errors", () => {
    const err = new Error("read ECONNRESET");
    const wrapped = wrapError(err);
    expect(wrapped.code).toBe(ReaderErrorCode.NETWORK_ERROR);
  });

  it("wraps proxy errors", () => {
    const err = new Error("proxy connection failed: tunnel timeout");
    const wrapped = wrapError(err);
    expect(wrapped.code).toBe(ReaderErrorCode.PROXY_CONNECTION_ERROR);
  });

  it("wraps cloudflare errors", () => {
    const err = new Error("Cloudflare challenge detected");
    const wrapped = wrapError(err);
    expect(wrapped.code).toBe(ReaderErrorCode.CLOUDFLARE_CHALLENGE);
  });

  it("wraps supermarkdown conversion errors", () => {
    const err = new Error("Supermarkdown conversion failed: Formatting argument out of range");
    const wrapped = wrapError(err);
    expect(wrapped.code).toBe(ReaderErrorCode.MARKDOWN_CONVERSION_FAILED);
  });

  it("wraps unknown errors as UNKNOWN", () => {
    const err = new Error("something completely unexpected");
    const wrapped = wrapError(err);
    expect(wrapped.code).toBe(ReaderErrorCode.UNKNOWN);
  });

  it("wraps non-Error objects", () => {
    const wrapped = wrapError("string error");
    expect(wrapped.code).toBe(ReaderErrorCode.UNKNOWN);
    expect(wrapped.message).toBe("string error");
  });

  it("preserves cause chain", () => {
    const cause = new Error("root");
    const err = new Error("surface: root");
    const wrapped = wrapError(err, "https://example.com");
    expect(wrapped.cause).toBeDefined();
  });
});
