/**
 * Screenshot Format Tests
 *
 * Tests that the "screenshot" format flows correctly through the pipeline:
 * - Types accept "screenshot" as a valid format
 * - EngineResult can carry screenshot data
 * - Scraper passes screenshot through to WebsiteScrapeResult
 */

import { describe, it, expect, vi } from "vitest";
import { isValidFormat } from "../../src/types";
import { Scraper } from "../../src/scraper";
import type { WebsiteScrapeResult } from "../../src/types";

// ── Type validation ─────────────────────────────────────────────────────────

describe("Screenshot format validation", () => {
  it("accepts 'screenshot' as a valid format", () => {
    expect(isValidFormat("screenshot")).toBe(true);
  });

  it("accepts 'markdown' as a valid format", () => {
    expect(isValidFormat("markdown")).toBe(true);
  });

  it("accepts 'html' as a valid format", () => {
    expect(isValidFormat("html")).toBe(true);
  });

  it("rejects invalid formats", () => {
    expect(isValidFormat("pdf")).toBe(false);
    expect(isValidFormat("text")).toBe(false);
    expect(isValidFormat("")).toBe(false);
  });
});

// ── Scraper pipeline ────────────────────────────────────────────────────────

describe("Screenshot in scraper pipeline", () => {
  function makeResult(overrides?: Partial<WebsiteScrapeResult>): WebsiteScrapeResult {
    return {
      rawHtml: "<html><body><h1>Hello</h1><p>Content here for testing.</p></body></html>",
      markdown: "# Hello\n\nContent here for testing.",
      metadata: {
        baseUrl: "https://example.com",
        statusCode: 200,
        engine: "playwright",
        totalPages: 1,
        scrapedAt: new Date().toISOString(),
        duration: 100,
        website: { title: "Example", description: null } as any,
      },
      ...overrides,
    };
  }

  function makeScraper(overrides?: Record<string, unknown>): Scraper {
    return new Scraper({
      urls: ["https://example.com"],
      formats: ["markdown", "screenshot"],
      ...overrides,
    });
  }

  function spySingleUrl(scraper: Scraper) {
    const spy = vi.fn() as any;
    (scraper as any).scrapeSingleUrl = spy;
    (scraper as any).logger = {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    };
    return spy;
  }

  it("passes screenshot through when present in engine result", async () => {
    const scraper = makeScraper();
    const spy = spySingleUrl(scraper);
    const fakeScreenshot = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAA";

    spy.mockResolvedValueOnce(makeResult({
      screenshot: fakeScreenshot,
    }));

    const { data } = await scraper.scrape();
    expect(data).toHaveLength(1);
    expect(data[0].screenshot).toBe(fakeScreenshot);
    expect(data[0].markdown).toContain("Hello");
  });

  it("screenshot is undefined when not in engine result", async () => {
    const scraper = new Scraper({
      urls: ["https://example.com"],
      formats: ["markdown"],
    });
    const spy = spySingleUrl(scraper);

    spy.mockResolvedValueOnce(makeResult());

    const { data } = await scraper.scrape();
    expect(data).toHaveLength(1);
    expect(data[0].screenshot).toBeUndefined();
  });

  it("screenshot can coexist with markdown and html", async () => {
    const scraper = new Scraper({
      urls: ["https://example.com"],
      formats: ["markdown", "html", "screenshot"],
    });
    const spy = spySingleUrl(scraper);

    spy.mockResolvedValueOnce(makeResult({
      html: "<h1>Hello</h1>",
      screenshot: "base64data",
    }));

    const { data } = await scraper.scrape();
    expect(data[0].markdown).toBeDefined();
    expect(data[0].html).toBeDefined();
    expect(data[0].screenshot).toBe("base64data");
  });
});
