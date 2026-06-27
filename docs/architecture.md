# Architecture

This document describes the internal architecture of Reader, helping contributors understand how the system works.

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Public API                                │
│              scrape() / crawl() / browser()                      │
└──────────┬─────────────────┬────────────────┬───────────────────┘
           │                 │                │
     ┌─────▼─────┐    ┌─────▼─────┐    ┌─────▼──────────┐
     │  Scraper  │    │  Crawler  │    │ BrowserSession │
     │  Class    │    │  Class    │    │ (CDP WebSocket)│
     └─────┬─────┘    └─────┬─────┘    └─────┬──────────┘
           │                │                │
           └────────┬───────┘                │ own browser
                    │                        │
          ┌─────────▼─────────┐    ┌─────────▼─────────┐
          │ TieredBrowserPool │    │  Dedicated Chrome  │
          │ (shared, pooled)  │    │  (per-session)     │
          └─────────┬─────────┘    └───────────────────┘
                    │
    ┌───────────────┼───────────────┐
    │               │               │
┌───▼──────────┐ ┌──▼──────────┐ ┌──▼────────────┐
│  Browser     │ │  Orchestrator│ │  Formatters   │
│  Config      │ │   Detection  │ │ (MD, HTML, etc) │
└──────────────┘ └─────────────┘ └─────────────────┘
```

## Directory Structure

```
src/
├── index.ts              # Public API exports
├── scraper.ts            # Scraper class - main scraping logic
├── crawler.ts            # Crawler class - link discovery + scraping
├── types.ts              # ScrapeOptions, ScrapeResult, etc.
├── crawl-types.ts        # CrawlOptions, CrawlResult, etc.
│
├── browser/
│   ├── pool.ts           # BrowserPool - manages Playwright instances
│   └── types.ts          # IBrowserPool, PoolConfig, PoolStats
│
├── cloudflare/
│   ├── detector.ts       # detectChallenge() - DOM/text matching
│   ├── handler.ts        # waitForChallengeResolution() - polling
│   └── types.ts          # ChallengeDetection, ResolutionResult
│
├── formatters/
│   ├── markdown.ts       # formatToMarkdown() - uses supermarkdown
│   ├── html.ts           # formatToHTML() - full HTML document
│   ├── postprocess.ts    # Post-processing utilities
│   └── index.ts          # Re-exports all formatters
│
├── utils/
│   ├── content-cleaner.ts    # cleanContent() - removes nav, ads
│   ├── metadata-extractor.ts # extractMetadata() - OG tags, etc.
│   ├── url-helpers.ts        # URL validation, normalization
│   ├── rate-limiter.ts       # Simple delay-based rate limiting
│   └── logger.ts             # Pino logger with pretty print
│
├── proxy/
│   └── config.ts         # createProxyUrl(), parseProxyUrl()
│
└── cli/
    └── index.ts          # CLI using Commander.js
```

## Core Components

### Scraper

The `Scraper` class (`src/scraper.ts`) handles URL scraping:

```typescript
class Scraper {
  constructor(options: ScrapeOptions) { ... }

  async scrape(): Promise<ScrapeResult> {
    // 1. Initialize browser pool
    // 2. Process URLs with concurrency control (p-limit)
    // 3. For each URL: fetch, detect challenges, extract content
    // 4. Format to requested output formats
    // 5. Aggregate results and metadata
  }

  private async scrapeSingleUrl(url: string): Promise<WebsiteScrapeResult> {
    // 1. Acquire browser from pool
    // 2. Navigate to URL
    // 3. Detect Cloudflare challenge
    // 4. Wait for resolution if needed
    // 5. Extract HTML and metadata
    // 6. Clean content
    // 7. Format to outputs
    // 8. Release browser to pool
  }
}
```

**Key design decisions:**

- Uses `p-limit` for concurrency control
- Each URL gets its own browser instance from the pool
- Cloudflare detection runs before content extraction
- All formatters run in parallel for each URL

### Crawler

The `Crawler` class (`src/crawler.ts`) discovers links:

```typescript
class Crawler {
  async crawl(): Promise<CrawlResult> {
    // BFS (Breadth-First Search) algorithm
    // 1. Start with seed URL at depth 0
    // 2. Fetch page, extract links
    // 3. Filter links (same domain, patterns)
    // 4. Add to queue with depth + 1
    // 5. Repeat until maxPages or maxDepth
    // 6. Optionally scrape discovered URLs
  }
}
```

**Key design decisions:**

- BFS ensures shallow pages are discovered first
- Respects `maxPages` and `depth` limits
- Optional scraping reuses the Scraper class
- Delay between requests for rate limiting

### Browser Pool

The `BrowserPool` class (`src/browser/pool.ts`) manages Playwright page instances:

```typescript
class BrowserPool {
  private instances: PageInstance[];
  private available: PageInstance[];
  private queue: PendingRequest[];

  async initialize(): Promise<void> { ... }
  async acquire(): Promise<Page> { ... }
  async release(page: Page): Promise<void> { ... }

  async withBrowser<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const page = await this.acquire();
    try {
      return await fn(page);
    } finally {
      await this.release(page);
    }
  }
}
```

**Pool lifecycle:**

1. **Initialize** - Create `size` Playwright page instances
2. **Acquire** - Get available instance or queue the request
3. **Use** - Execute scraping logic
4. **Release** - Return to pool or recycle if stale
5. **Recycle** - Close old instance, create new one
6. **Shutdown** - Close all instances

**Recycling triggers:**

- After N pages (default: 100)
- After N minutes (default: 30)
- On health check failure

### Cloudflare Detection

Detection happens in two phases:

**1. Challenge Detection** (`src/cloudflare/detector.ts`):

```typescript
async function detectChallenge(page: Page): Promise<ChallengeDetection> {
  // Check DOM for challenge elements
  const signals = [];

  // CSS selectors that indicate challenges
  if (await page.$("#challenge-form")) {
    signals.push({ type: "dom", selector: "#challenge-form" });
  }

  // Text patterns that indicate challenges
  const bodyText = await page.textContent("body");
  if (bodyText?.includes("checking your browser")) {
    signals.push({ type: "text", pattern: "checking your browser" });
  }

  return {
    isChallenge: signals.length > 0,
    type: determineType(signals),
    signals,
  };
}
```

**2. Challenge Resolution** (`src/cloudflare/handler.ts`):

```typescript
async function waitForChallengeResolution(
  page: Page,
  options: ResolutionOptions
): Promise<ResolutionResult> {
  const startTime = Date.now();

  while (Date.now() - startTime < options.maxWaitMs) {
    // Check if URL changed (redirect after challenge)
    if (page.url() !== options.initialUrl) {
      return { resolved: true, method: "redirect" };
    }

    // Check if challenge elements disappeared
    const detection = await detectChallenge(page);
    if (!detection.isChallenge) {
      return { resolved: true, method: "element_removal" };
    }

    await sleep(options.pollIntervalMs);
  }

  return { resolved: false };
}
```

### Formatters

Each formatter transforms scraped pages into a specific format:

| Formatter | Input | Output |
|-----------|-------|--------|
| `formatToMarkdown` | Pages, metadata | Markdown document with frontmatter |
| `formatToHTML` | Pages, metadata | Complete HTML document with CSS |

**Markdown formatter** uses [supermarkdown](https://github.com/vakra-dev/supermarkdown) - a high-performance Rust-based HTML-to-Markdown converter with full GFM support.

## Data Flow

### Scrape Request Flow

```
scrape({ urls: ["https://example.com"], formats: ["markdown"] })
  │
  ├─► Scraper.scrape()
  │     │
  │     ├─► BrowserPool.initialize(size=concurrency)
  │     │
  │     ├─► For each URL (controlled by p-limit):
  │     │     │
  │     │     ├─► pool.withBrowser(async page => {
  │     │     │     │
  │     │     │     ├─► page.goto(url)
  │     │     │     │
  │     │     │     ├─► detectChallenge(page)
  │     │     │     │     └─► Returns { isChallenge, type, signals }
  │     │     │     │
  │     │     │     ├─► if (isChallenge):
  │     │     │     │     └─► waitForChallengeResolution(page)
  │     │     │     │
  │     │     │     ├─► Extract title, HTML
  │     │     │     │
  │     │     │     ├─► cleanContent(html)
  │     │     │     │     └─► Remove nav, ads, scripts
  │     │     │     │
  │     │     │     ├─► extractMetadata(html)
  │     │     │     │     └─► OG tags, Twitter cards, etc.
  │     │     │     │
  │     │     │     └─► Format to requested formats
  │     │     │   })
  │     │     │
  │     │     └─► Add to results array
  │     │
  │     ├─► pool.shutdown()
  │     │
  │     └─► Return ScrapeResult { data[], batchMetadata }
  │
  └─► Result returned to caller
```

### Crawl Request Flow

```
crawl({ url: "https://example.com", depth: 2, scrape: true })
  │
  ├─► Crawler.crawl()
  │     │
  │     ├─► Initialize queue with seed URL at depth 0
  │     │
  │     ├─► BFS loop (while queue not empty && pages < maxPages):
  │     │     │
  │     │     ├─► Dequeue next URL
  │     │     │
  │     │     ├─► Fetch page with Playwright
  │     │     │
  │     │     ├─► Extract links via regex
  │     │     │
  │     │     ├─► Filter links:
  │     │     │     ├─► Same domain only
  │     │     │     ├─► Match includePatterns
  │     │     │     └─► Exclude excludePatterns
  │     │     │
  │     │     ├─► Add new links to queue with depth + 1
  │     │     │
  │     │     ├─► Rate limit (delay between requests)
  │     │     │
  │     │     └─► Add to discovered URLs
  │     │
  │     ├─► If scrape=true:
  │     │     └─► scrape({ urls: discoveredUrls })
  │     │
  │     └─► Return CrawlResult { urls[], scraped?, metadata }
  │
  └─► Result returned to caller
```

## Design Decisions

### Why Playwright?

Playwright was chosen for:

1. **Stealth** - Compatible with fingerprint-generator, stealth scripts, and proxy-chain
2. **Speed** - Optimized for headless automation
3. **API** - Clean async/await interface with full browser control
4. **Stability** - Production-tested at scale with broad community support

### Pool vs Per-Request Browsers

We use a pool because:

- Browser startup is slow (~2-3 seconds)
- Memory overhead per browser is high
- Connection reuse improves performance

Trade-off: Stale browsers can accumulate state, so we recycle them periodically.

### Cloudflare Detection Strategy

Multi-signal approach because:

- No single indicator is 100% reliable
- Cloudflare changes their challenge pages
- Different challenge types have different signatures

Detection signals include:
- DOM elements (`#challenge-form`, `.cf-browser-verification`)
- Text patterns ("checking your browser", "ray id")
- URL patterns (`/cdn-cgi/challenge-platform/`)
- HTTP status codes

### Content Cleaning

We clean HTML before formatting because:

- Navigation, ads, scripts bloat output
- LLMs perform better with focused content
- Reduces token usage

Cleaning removes:
- `<script>`, `<style>` tags
- Navigation elements
- Footer/sidebar content
- Ad containers
- Hidden elements

## Extension Points

### Adding a New Formatter

1. Create `src/formatters/newformat.ts`:
   ```typescript
   export function formatToNewFormat(
     pages: Page[],
     baseUrl: string,
     scrapedAt: string,
     duration: number,
     metadata?: WebsiteMetadata
   ): string {
     // Your formatting logic
   }
   ```

2. Export from `src/formatters/index.ts`

3. Add to format type in `src/types.ts`:
   ```typescript
   formats?: Array<"markdown" | "html" | "newformat">
   ```

4. Call formatter in `src/scraper.ts`

### Adding a New ScrapeOption

1. Add to `ScrapeOptions` in `src/types.ts`
2. Add default in `DEFAULT_OPTIONS`
3. Use in `Scraper` class via `this.options.newOption`
4. Add CLI flag in `src/cli/index.ts` if needed

### Modifying Cloudflare Detection

- Detection patterns: `src/cloudflare/detector.ts`
- Resolution logic: `src/cloudflare/handler.ts`

## Testing

```bash
cd reader && npx vitest run
```

415 unit tests across 26 test files covering scraping, crawling, browser sessions, formatters, content cleaning, proxy pools, and error handling.

## Related Guides

- [Browser Pool](guides/browser-pool.md) - Deep dive into pool management
- [Cloudflare Bypass](guides/cloudflare-bypass.md) - Understanding antibot bypass
- [Production Server](deployment/production-server.md) - Server deployment pattern
