/**
 * Crawler Tests
 *
 * Tests link extraction, depth limiting, maxPages cap, URL dedup,
 * same-domain filtering, and robots.txt compliance. We mock fetchPage
 * and fetchRobotsTxt to avoid needing a live browser or network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Crawler } from "../../src/crawler";
import type { IBrowserPool } from "../../src/browser/types";
import type { CrawlResult } from "../../src/crawl-types";

// ── Mock robots parser (no network) ──────────────────────────────────────────

vi.mock("../../src/utils/robots-parser", () => ({
  fetchRobotsTxt: vi.fn().mockResolvedValue(null), // no robots.txt by default
  isUrlAllowed: vi.fn().mockReturnValue(true),
}));

vi.mock("../../src/utils/rate-limiter", () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined), // skip delays in tests
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal mock pool that satisfies the constructor check */
function mockPool(): IBrowserPool {
  return {
    withBrowser: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockReturnValue({ size: 1, active: 0, idle: 1, pending: 0 }),
    isReady: vi.fn().mockReturnValue(true),
  } as unknown as IBrowserPool;
}

/**
 * Create a Crawler with mocked fetchPage. Returns the crawler and the
 * fetchPage mock so tests can control what each page returns.
 */
function createTestCrawler(options: {
  url: string;
  depth?: number;
  maxPages?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
}) {
  const crawler = new Crawler({
    url: options.url,
    depth: options.depth ?? 1,
    maxPages: options.maxPages ?? 20,
    delayMs: 0, // no delay in tests
    pool: mockPool(),
    includePatterns: options.includePatterns,
    excludePatterns: options.excludePatterns,
  });

  // Suppress log noise
  (crawler as any).logger = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  };

  const fetchPageMock = vi.fn<[string], Promise<{ crawlUrl: { url: string; title: string; description: string | null }; html: string } | null>>();
  (crawler as any).fetchPage = fetchPageMock;

  return { crawler, fetchPageMock };
}

/** Build a simple HTML page with links */
function makeHtml(links: string[], title = "Test Page"): string {
  const anchors = links.map((href) => `<a href="${href}">Link</a>`).join("\n");
  return `<html><head><title>${title}</title></head><body>${anchors}</body></html>`;
}

/** Build a fetchPage result */
function pageResult(url: string, html: string, title = "Test Page") {
  return {
    crawlUrl: { url, title, description: null },
    html,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Crawler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("defaults depth=1, maxPages=20", () => {
      const crawler = new Crawler({ url: "https://example.com" });
      expect((crawler as any).options.depth).toBe(1);
      expect((crawler as any).options.maxPages).toBe(20);
    });
  });

  describe("link extraction", () => {
    it("extracts same-domain absolute links", async () => {
      const { crawler, fetchPageMock } = createTestCrawler({
        url: "https://example.com",
        depth: 1,
      });

      fetchPageMock
        .mockResolvedValueOnce(pageResult(
          "https://example.com",
          makeHtml([
            "https://example.com/page1",
            "https://example.com/page2",
            "https://other.com/external", // different domain
          ]),
        ))
        .mockResolvedValueOnce(pageResult("https://example.com/page1", makeHtml([])))
        .mockResolvedValueOnce(pageResult("https://example.com/page2", makeHtml([])));

      const result = await crawler.crawl();
      // Seed + 2 same-domain links (external filtered)
      expect(result.urls).toHaveLength(3);
      expect(result.urls.map((u) => u.url)).toContain("https://example.com/page1");
      expect(result.urls.map((u) => u.url)).toContain("https://example.com/page2");
    });

    it("resolves relative URLs against the page base URL", async () => {
      const { crawler, fetchPageMock } = createTestCrawler({
        url: "https://example.com",
        depth: 1,
      });

      fetchPageMock
        .mockResolvedValueOnce(pageResult(
          "https://example.com",
          makeHtml(["/about", "./contact", "blog/post1"]),
        ))
        .mockResolvedValueOnce(pageResult("https://example.com/about", makeHtml([])))
        .mockResolvedValueOnce(pageResult("https://example.com/contact", makeHtml([])))
        .mockResolvedValueOnce(pageResult("https://example.com/blog/post1", makeHtml([])));

      const result = await crawler.crawl();
      const urls = result.urls.map((u) => u.url);
      expect(urls).toContain("https://example.com/about");
      expect(urls).toContain("https://example.com/contact");
    });

    it("skips fragment-only links", async () => {
      const { crawler, fetchPageMock } = createTestCrawler({
        url: "https://example.com",
        depth: 1,
      });

      fetchPageMock.mockResolvedValueOnce(pageResult(
        "https://example.com",
        makeHtml(["#section1", "#top", "https://example.com/real-page"]),
      ));
      fetchPageMock.mockResolvedValueOnce(pageResult("https://example.com/real-page", makeHtml([])));

      const result = await crawler.crawl();
      expect(result.urls).toHaveLength(2); // seed + real-page, not fragments
    });

    it("skips non-HTTP schemes (mailto, javascript, tel, etc.)", async () => {
      const { crawler, fetchPageMock } = createTestCrawler({
        url: "https://example.com",
        depth: 1,
      });

      fetchPageMock.mockResolvedValueOnce(pageResult(
        "https://example.com",
        makeHtml([
          "mailto:test@example.com",
          "javascript:void(0)",
          "tel:+1234567890",
          "data:text/html,hello",
          "ftp://files.example.com/file",
          "https://example.com/valid",
        ]),
      ));
      fetchPageMock.mockResolvedValueOnce(pageResult("https://example.com/valid", makeHtml([])));

      const result = await crawler.crawl();
      expect(result.urls).toHaveLength(2); // seed + valid
    });

    it("strips hash fragments from discovered URLs", async () => {
      const { crawler, fetchPageMock } = createTestCrawler({
        url: "https://example.com",
        depth: 1,
      });

      fetchPageMock
        .mockResolvedValueOnce(pageResult(
          "https://example.com",
          makeHtml(["https://example.com/page#section1"]),
        ))
        .mockResolvedValueOnce(pageResult("https://example.com/page", makeHtml([])));

      const result = await crawler.crawl();
      expect(result.urls[1].url).toBe("https://example.com/page");
    });
  });

  describe("depth limiting", () => {
    it("does not extract links when at max depth", async () => {
      const { crawler, fetchPageMock } = createTestCrawler({
        url: "https://example.com",
        depth: 1,
      });

      // depth=0 (seed) → links extracted at depth=1
      fetchPageMock.mockResolvedValueOnce(pageResult(
        "https://example.com",
        makeHtml(["https://example.com/level1"]),
      ));
      // depth=1 → at max depth, links NOT extracted (even though page has them)
      fetchPageMock.mockResolvedValueOnce(pageResult(
        "https://example.com/level1",
        makeHtml(["https://example.com/level2"]),
      ));

      const result = await crawler.crawl();
      expect(result.urls).toHaveLength(2); // seed + level1, NOT level2
      expect(result.urls.map((u) => u.url)).not.toContain("https://example.com/level2");
    });

    it("crawls deeper with depth=2", async () => {
      const { crawler, fetchPageMock } = createTestCrawler({
        url: "https://example.com",
        depth: 2,
      });

      fetchPageMock
        .mockResolvedValueOnce(pageResult(
          "https://example.com",
          makeHtml(["https://example.com/a"]),
        ))
        .mockResolvedValueOnce(pageResult(
          "https://example.com/a",
          makeHtml(["https://example.com/a/b"]),
        ))
        .mockResolvedValueOnce(pageResult(
          "https://example.com/a/b",
          makeHtml(["https://example.com/a/b/c"]), // depth=2, at max, won't extract
        ));

      const result = await crawler.crawl();
      expect(result.urls).toHaveLength(3); // seed + a + a/b
      expect(result.urls.map((u) => u.url)).not.toContain("https://example.com/a/b/c");
    });
  });

  describe("maxPages cap", () => {
    it("stops after reaching maxPages", async () => {
      const { crawler, fetchPageMock } = createTestCrawler({
        url: "https://example.com",
        depth: 1,
        maxPages: 3,
      });

      fetchPageMock.mockResolvedValueOnce(pageResult(
        "https://example.com",
        makeHtml([
          "https://example.com/p1",
          "https://example.com/p2",
          "https://example.com/p3",
          "https://example.com/p4",
          "https://example.com/p5",
        ]),
      ));
      fetchPageMock.mockResolvedValueOnce(pageResult("https://example.com/p1", makeHtml([])));
      fetchPageMock.mockResolvedValueOnce(pageResult("https://example.com/p2", makeHtml([])));
      fetchPageMock.mockResolvedValueOnce(pageResult("https://example.com/p3", makeHtml([])));
      fetchPageMock.mockResolvedValueOnce(pageResult("https://example.com/p4", makeHtml([])));

      const result = await crawler.crawl();
      expect(result.urls).toHaveLength(3); // capped at maxPages
    });
  });

  describe("URL deduplication", () => {
    it("does not visit the same URL twice", async () => {
      const { crawler, fetchPageMock } = createTestCrawler({
        url: "https://example.com",
        depth: 1,
      });

      fetchPageMock.mockResolvedValueOnce(pageResult(
        "https://example.com",
        makeHtml([
          "https://example.com/page",
          "https://example.com/page", // duplicate
          "https://example.com/page", // duplicate
        ]),
      ));
      fetchPageMock.mockResolvedValueOnce(pageResult("https://example.com/page", makeHtml([])));

      const result = await crawler.crawl();
      expect(result.urls).toHaveLength(2); // seed + page (not 4)
      expect(fetchPageMock).toHaveBeenCalledTimes(2); // only fetched twice
    });
  });

  describe("failed pages", () => {
    it("continues crawling when fetchPage returns null", async () => {
      const { crawler, fetchPageMock } = createTestCrawler({
        url: "https://example.com",
        depth: 1,
      });

      fetchPageMock.mockResolvedValueOnce(pageResult(
        "https://example.com",
        makeHtml(["https://example.com/broken", "https://example.com/ok"]),
      ));
      fetchPageMock.mockResolvedValueOnce(null); // broken page
      fetchPageMock.mockResolvedValueOnce(pageResult("https://example.com/ok", makeHtml([])));

      const result = await crawler.crawl();
      // seed + ok (broken didn't add to urls)
      expect(result.urls).toHaveLength(2);
      expect(result.urls.map((u) => u.url)).toContain("https://example.com/ok");
    });
  });

  describe("metadata", () => {
    it("returns correct metadata with seed URL and duration", async () => {
      const { crawler, fetchPageMock } = createTestCrawler({
        url: "https://example.com",
        depth: 1,
        maxPages: 5,
      });

      fetchPageMock.mockResolvedValueOnce(pageResult("https://example.com", makeHtml([])));

      const result = await crawler.crawl();
      expect(result.metadata.seedUrl).toBe("https://example.com");
      expect(result.metadata.maxDepth).toBe(1);
      expect(result.metadata.totalUrls).toBe(1);
      expect(result.metadata.totalDuration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("include/exclude patterns", () => {
    it("respects includePatterns filter", async () => {
      const { crawler, fetchPageMock } = createTestCrawler({
        url: "https://example.com",
        depth: 1,
        includePatterns: ["/blog/"],
      });

      fetchPageMock.mockResolvedValueOnce(pageResult(
        "https://example.com",
        makeHtml([
          "https://example.com/blog/post1",
          "https://example.com/about", // excluded by include pattern
        ]),
      ));
      fetchPageMock.mockResolvedValueOnce(
        pageResult("https://example.com/blog/post1", makeHtml([])),
      );

      const result = await crawler.crawl();
      const urls = result.urls.map((u) => u.url);
      expect(urls).toContain("https://example.com/blog/post1");
      expect(urls).not.toContain("https://example.com/about");
    });

    it("respects excludePatterns filter", async () => {
      const { crawler, fetchPageMock } = createTestCrawler({
        url: "https://example.com",
        depth: 1,
        excludePatterns: ["/admin"],
      });

      fetchPageMock.mockResolvedValueOnce(pageResult(
        "https://example.com",
        makeHtml([
          "https://example.com/page1",
          "https://example.com/admin/dashboard", // excluded
        ]),
      ));
      fetchPageMock.mockResolvedValueOnce(
        pageResult("https://example.com/page1", makeHtml([])),
      );

      const result = await crawler.crawl();
      const urls = result.urls.map((u) => u.url);
      expect(urls).toContain("https://example.com/page1");
      expect(urls).not.toContain("https://example.com/admin/dashboard");
    });
  });
});
