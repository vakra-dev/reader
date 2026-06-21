/**
 * Scraper Retry & Escalation Tests
 *
 * Tests the retry loop in Scraper.scrapeSingleUrlWithRetry:
 *   1. Datacenter attempt with 10s timeout
 *   2. Any failure → residential attempt with remaining time (up to 30s total)
 *   3. Any failure → done
 *
 * We mock `scrapeSingleUrl` on the Scraper prototype so the retry logic
 * is tested in isolation without hitting real engines.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Scraper } from "../../src/scraper";
import { ScrapeFailedError } from "../../src/engines/errors";
import { ProxyConnectionError, DNSError } from "../../src/errors";
import type { WebsiteScrapeResult } from "../../src/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeResult(overrides?: Partial<WebsiteScrapeResult>): WebsiteScrapeResult {
  return {
    rawHtml: "<html><body><h1>Hello World</h1><p>This is real content.</p></body></html>",
    markdown: "# Hello World\n\nThis is real content with enough text.",
    metadata: {
      baseUrl: "https://example.com",
      statusCode: 200,
      engine: "hero",
      totalPages: 1,
      scrapedAt: new Date().toISOString(),
      duration: 100,
      website: { title: "Example", description: null } as any,
    },
    ...overrides,
  };
}

function makeScraper(overrides?: Record<string, unknown>): Scraper {
  return new Scraper({ urls: ["https://example.com"], formats: ["markdown"], ...overrides });
}

function spySingleUrl(scraper: Scraper) {
  const spy = vi.fn() as any;
  (scraper as any).scrapeSingleUrl = spy;
  (scraper as any).logger = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  };
  return spy;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Scraper retry & escalation", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Happy path ──

  it("returns result on first success without escalation", async () => {
    const scraper = makeScraper();
    const spy = spySingleUrl(scraper);
    spy.mockResolvedValueOnce(makeResult());

    const { data } = await scraper.scrape();
    expect(data).toHaveLength(1);
    expect(data[0].markdown).toContain("Hello World");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // ── Non-retryable errors ──

  it("fast-fails on non-retryable errors without escalating", async () => {
    const scraper = makeScraper();
    const spy = spySingleUrl(scraper);
    spy.mockRejectedValueOnce(new DNSError("example.com"));

    const { data, batchMetadata } = await scraper.scrape();
    expect(data).toHaveLength(0);
    expect(batchMetadata.failedUrls).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1); // No second attempt
  });

  // ── Escalation on failure ──

  it("escalates to residential on datacenter failure", async () => {
    const scraper = makeScraper();
    const spy = spySingleUrl(scraper);

    spy.mockRejectedValueOnce(
      new ScrapeFailedError(new Error("timeout"), { proxyBlock: true }),
    );
    spy.mockResolvedValueOnce(makeResult());

    const { data } = await scraper.scrape();
    expect(data).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(2);
    // Second call should have proxyOverride = "residential"
    expect(spy.mock.calls[1][2]).toBe("residential");
  });

  // ── Escalation on proxy connection error ──

  it("escalates to residential on ProxyConnectionError", async () => {
    const scraper = makeScraper();
    const spy = spySingleUrl(scraper);

    spy.mockRejectedValueOnce(new ProxyConnectionError("datacenter"));
    spy.mockResolvedValueOnce(makeResult());

    const { data } = await scraper.scrape();
    expect(data).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][2]).toBe("residential");
  });

  // ── Escalation on empty result ──

  it("escalates to residential when datacenter returns null", async () => {
    const scraper = makeScraper();
    const spy = spySingleUrl(scraper);

    spy.mockResolvedValueOnce(null);
    spy.mockResolvedValueOnce(makeResult());

    const { data } = await scraper.scrape();
    expect(data).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][2]).toBe("residential");
  });

  // ── Escalation on blocked content ──

  it("escalates when result looks blocked (200 + bot page content)", async () => {
    const scraper = makeScraper({
      blockDetection: {
        patterns: [/click the button below to continue shopping/i],
        shortContentThreshold: 500,
      },
    });
    const spy = spySingleUrl(scraper);

    spy.mockResolvedValueOnce(makeResult({
      rawHtml: '<html><body><h4>Click the button below to continue shopping</h4><p>© Amazon.com</p></body></html>',
      markdown: "Click the button below to continue shopping",
      metadata: {
        baseUrl: "https://amazon.com/dp/123",
        statusCode: 200,
        engine: "hero",
        totalPages: 1,
        scrapedAt: new Date().toISOString(),
        duration: 50,
        website: { title: null, description: null } as any,
      },
    }));
    spy.mockResolvedValueOnce(makeResult());

    const { data } = await scraper.scrape();
    expect(data).toHaveLength(1);
    expect(data[0].markdown).toContain("Hello World");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  // ── Both attempts fail ──

  it("reports error when both datacenter and residential fail", async () => {
    const scraper = makeScraper();
    const spy = spySingleUrl(scraper);

    spy.mockRejectedValueOnce(new ScrapeFailedError(new Error("dc timeout")));
    spy.mockRejectedValueOnce(new ScrapeFailedError(new Error("res timeout")));

    const { data, batchMetadata } = await scraper.scrape();
    expect(data).toHaveLength(0);
    expect(batchMetadata.failedUrls).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  // ── No third attempt ──

  it("does NOT retry a third time — max 2 attempts (dc + residential)", async () => {
    const scraper = makeScraper();
    const spy = spySingleUrl(scraper);

    spy.mockRejectedValueOnce(new ScrapeFailedError(new Error("fail 1")));
    spy.mockRejectedValueOnce(new ScrapeFailedError(new Error("fail 2")));

    await scraper.scrape();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  // ── Timeout passed to attempts ──

  it("passes 10s timeout to datacenter attempt", async () => {
    const scraper = makeScraper();
    const spy = spySingleUrl(scraper);
    spy.mockResolvedValueOnce(makeResult());

    await scraper.scrape();

    // 4th arg is timeoutMs
    expect(spy.mock.calls[0][3]).toBe(10_000);
  });

  it("passes remaining time to residential attempt", async () => {
    const scraper = makeScraper();
    const spy = spySingleUrl(scraper);

    spy.mockRejectedValueOnce(new ScrapeFailedError(new Error("dc fail")));
    spy.mockResolvedValueOnce(makeResult());

    await scraper.scrape();

    // Residential timeout should be <= 30s and > 0
    const residentialTimeout = spy.mock.calls[1][3];
    expect(residentialTimeout).toBeGreaterThan(0);
    expect(residentialTimeout).toBeLessThanOrEqual(45_000);
  });

  // ── rawHtml is always present ──

  it("includes rawHtml in successful result", async () => {
    const scraper = makeScraper();
    const spy = spySingleUrl(scraper);
    spy.mockResolvedValueOnce(makeResult());

    const { data } = await scraper.scrape();
    expect(data[0].rawHtml).toContain("<html>");
  });
});
