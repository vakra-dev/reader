# API Reference

Complete API documentation for Reader.

## ReaderClient (Recommended)

The recommended way to use Reader. Manages the Playwright browser pool lifecycle automatically, reuses connections efficiently, and auto-closes on process exit.

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient({ verbose: true });

// Scrape URLs
const result = await reader.scrape({
  urls: ["https://example.com"],
  formats: ["markdown"],
});

// Crawl a website
const crawlResult = await reader.crawl({
  url: "https://example.com",
  depth: 2,
});

// Launch a stealthed browser session
const session = await reader.browser();
// → session.wsEndpoint for Playwright/Puppeteer

// Close when done (optional - auto-closes on exit)
await reader.close();
```

### Constructor

```typescript
new ReaderClient(options?: ReaderClientOptions)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `verbose` | `boolean` | `false` | Enable verbose logging |
| `showChrome` | `boolean` | `false` | Show browser window for debugging |
| `browserPool` | `BrowserPoolConfig` | - | Browser pool configuration |
| `proxyPools` | `ProxyPoolConfig` | - | Tiered proxy pools (standard + premium) |
| `proxies` | `ProxyConfig[]` | - | List of proxies to rotate through (legacy) |
| `proxyRotation` | `"round-robin" \| "random"` | `"round-robin"` | Proxy rotation strategy |

#### ProxyPoolConfig

```typescript
interface ProxyPoolConfig {
  standard?: ProxyConfig[];   // datacenter proxies, fast, most sites
  premium?: ProxyConfig[];   // residential proxies, anti-bot sites
}
```

#### BrowserPoolConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `size` | `number` | `2` | Number of browser instances |
| `retireAfterPages` | `number` | `100` | Retire browser after N page loads |
| `retireAfterMinutes` | `number` | `30` | Retire browser after N minutes |
| `maxQueueSize` | `number` | `100` | Maximum pending requests in queue |

### Methods

#### start()

Pre-initialize the browser pool. Called automatically on first scrape/crawl.

```typescript
await reader.start(): Promise<void>
```

#### scrape(options)

Scrape one or more URLs.

```typescript
const result = await reader.scrape(options): Promise<ScrapeResult>
```

See [ScrapeOptions](#scrapeoptions) for available options.

#### crawl(options)

Crawl a website to discover pages.

```typescript
const result = await reader.crawl(options): Promise<CrawlResult>
```

See [CrawlOptions](#crawloptions) for available options.

#### browser(options?)

Launch a stealthed browser session and return a CDP WebSocket URL for Playwright/Puppeteer.

```typescript
const session = await reader.browser(options?): Promise<BrowserSession>
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `proxy` | `ProxyConfig` | - | Proxy configuration |
| `proxyTier` | `ProxyTier` | - | Proxy tier: `"standard"` or `"premium"` |
| `showChrome` | `boolean` | `false` | Show browser window |
| `timeoutMs` | `number` | `300000` | Session lifetime (auto-closes after) |
| `verbose` | `boolean` | `false` | Enable verbose logging |

Returns:

```typescript
interface BrowserSession {
  sessionId: string;       // Unique session identifier
  wsEndpoint: string;      // CDP WebSocket URL
  createdAt: string;       // ISO timestamp
  close(): Promise<void>;  // Close session and release resources
}
```

See the [Browser Sessions guide](guides/browser-sessions.md) for full examples.

#### isReady()

Check if the client is initialized and ready.

```typescript
reader.isReady(): boolean
```

#### close()

Close the client and release resources.

```typescript
await reader.close(): Promise<void>
```

---

## Direct Functions (Advanced)

For advanced use cases where you need direct function access, you can use the direct functions.

### scrape(options)

Scrape one or more URLs and return content in specified formats.

```typescript
import { scrape } from "@vakra-dev/reader";

const result = await scrape({
  urls: ["https://example.com"],
  formats: ["markdown"],
});
```

#### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `urls` | `string[]` | Yes | - | Array of URLs to scrape |
| `formats` | `FormatType[]` | No | `["markdown"]` | Output formats |
| `onlyMainContent` | `boolean` | No | `true` | Extract only main content |
| `includeTags` | `string[]` | No | `[]` | CSS selectors for elements to keep |
| `excludeTags` | `string[]` | No | `[]` | CSS selectors for elements to remove |
| `userAgent` | `string` | No | - | Custom user agent string |
| `timeoutMs` | `number` | No | `30000` | Request timeout in milliseconds |
| `batchConcurrency` | `number` | No | `1` | URLs to process in parallel |
| `batchTimeoutMs` | `number` | No | `300000` | Total batch timeout |
| `onProgress` | `ProgressCallback` | No | - | Progress callback function |
| `proxy` | `ProxyConfig` | No | - | Proxy configuration |
| `proxyTier` | `ProxyTier` | No | - | Proxy tier: `"standard"` or `"premium"` |
| `waitForSelector` | `string` | No | - | CSS selector to wait for |
| `verbose` | `boolean` | No | `false` | Enable verbose logging |
| `showChrome` | `boolean` | No | `false` | Show browser window |


#### Returns

`Promise<ScrapeResult>`

```typescript
interface ScrapeResult {
  data: WebsiteScrapeResult[];
  batchMetadata: BatchMetadata;
}
```

#### Example

```typescript
// Using ReaderClient (recommended)
const reader = new ReaderClient();
const result = await reader.scrape({
  urls: ["https://example.com", "https://example.org"],
  formats: ["markdown", "html"],
  batchConcurrency: 2,
  onProgress: ({ completed, total, currentUrl }) => {
    console.log(`[${completed}/${total}] ${currentUrl}`);
  },
});

for (const site of result.data) {
  console.log("URL:", site.metadata.baseUrl);
  console.log("Markdown:", site.markdown?.substring(0, 200));
}

await reader.close();
```

---

### crawl(options)

Crawl a website to discover pages, optionally scraping their content.

```typescript
// Using ReaderClient (recommended)
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient();
const result = await reader.crawl({
  url: "https://example.com",
  depth: 2,
  maxPages: 20,
  scrape: true,
});
await reader.close();
```

#### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `url` | `string` | Yes | - | Seed URL to start crawling |
| `depth` | `number` | No | `1` | Maximum crawl depth |
| `maxPages` | `number` | No | `20` | Maximum pages to discover |
| `scrape` | `boolean` | No | `false` | Also scrape discovered pages |
| `delayMs` | `number` | No | `1000` | Delay between requests |
| `timeoutMs` | `number` | No | - | Total crawl timeout |
| `includePatterns` | `string[]` | No | - | URL patterns to include |
| `excludePatterns` | `string[]` | No | - | URL patterns to exclude |
| `formats` | `FormatType[]` | No | `["markdown", "html"]` | Output formats when scraping |
| `scrapeConcurrency` | `number` | No | `2` | Scraping parallelism |
| `proxy` | `ProxyConfig` | No | - | Proxy configuration |
| `userAgent` | `string` | No | - | Custom user agent |
| `verbose` | `boolean` | No | `false` | Enable verbose logging |
| `showChrome` | `boolean` | No | `false` | Show browser window |


#### Returns

`Promise<CrawlResult>`

```typescript
interface CrawlResult {
  urls: CrawlUrl[];
  scraped?: ScrapeResult;
  metadata: CrawlMetadata;
}
```

#### Example

```typescript
const reader = new ReaderClient();
const result = await reader.crawl({
  url: "https://docs.example.com",
  depth: 3,
  maxPages: 50,
  includePatterns: ["docs/*"],
  excludePatterns: ["docs/archive/*"],
  scrape: true,
});

console.log(`Discovered ${result.urls.length} pages`);
result.urls.forEach((page) => {
  console.log(`- ${page.title}: ${page.url}`);
});

if (result.scraped) {
  console.log(`Scraped ${result.scraped.batchMetadata.successfulUrls} pages`);
}

await reader.close();
```

---

## Type Definitions

### ScrapeOptions

```typescript
interface ScrapeOptions {
  urls: string[];
  formats?: Array<"markdown" | "html">;
  onlyMainContent?: boolean;
  includeTags?: string[];
  excludeTags?: string[];
  userAgent?: string;
  timeoutMs?: number;
  batchConcurrency?: number;
  batchTimeoutMs?: number;
  onProgress?: (progress: ProgressInfo) => void;
  proxy?: ProxyConfig;
  proxyTier?: "standard" | "premium";
  waitForSelector?: string;
  verbose?: boolean;
  showChrome?: boolean;
}
```

### CrawlOptions

```typescript
interface CrawlOptions {
  url: string;
  depth?: number;
  maxPages?: number;
  scrape?: boolean;
  delayMs?: number;
  timeoutMs?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
  formats?: Array<"markdown" | "html">;
  scrapeConcurrency?: number;
  proxy?: ProxyConfig;
  userAgent?: string;
  verbose?: boolean;
  showChrome?: boolean;
}
```

### ProxyConfig

```typescript
interface ProxyConfig {
  url?: string;
  type?: "standard" | "premium";
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  country?: string;
}
```

### ScrapeResult

```typescript
interface ScrapeResult {
  data: WebsiteScrapeResult[];
  batchMetadata: BatchMetadata;
}
```

### WebsiteScrapeResult

```typescript
interface WebsiteScrapeResult {
  markdown?: string;
  html?: string;
  metadata: {
    baseUrl: string;
    finalUrl?: string;  // Present if URL redirected
    totalPages: number;
    scrapedAt: string;
    duration: number;
    website: WebsiteMetadata;
    proxy?: ProxyMetadata;  // Included when proxy pooling is used
  };
}
```

### ProxyMetadata

```typescript
interface ProxyMetadata {
  host: string;
  port: number;
  country?: string;  // If geo-targeting was used
}
```

### BatchMetadata

```typescript
interface BatchMetadata {
  totalUrls: number;
  successfulUrls: number;
  failedUrls: number;
  scrapedAt: string;
  totalDuration: number;
  errors?: Array<{ url: string; error: string }>;
}
```

### CrawlResult

```typescript
interface CrawlResult {
  urls: CrawlUrl[];
  scraped?: ScrapeResult;
  metadata: CrawlMetadata;
}
```

### CrawlUrl

```typescript
interface CrawlUrl {
  url: string;
  title: string;
  description: string | null;
}
```

### CrawlMetadata

```typescript
interface CrawlMetadata {
  totalUrls: number;
  maxDepth: number;
  totalDuration: number;
  seedUrl: string;
}
```

### WebsiteMetadata

```typescript
interface WebsiteMetadata {
  title: string | null;
  description: string | null;
  author: string | null;
  language: string | null;
  charset: string | null;
  favicon: string | null;
  image: string | null;
  canonical: string | null;
  keywords: string[] | null;
  robots: string | null;
  themeColor: string | null;
  openGraph: {
    title: string | null;
    description: string | null;
    type: string | null;
    url: string | null;
    image: string | null;
    siteName: string | null;
    locale: string | null;
  } | null;
  twitter: {
    card: string | null;
    site: string | null;
    creator: string | null;
    title: string | null;
    description: string | null;
    image: string | null;
  } | null;
}
```

### ProgressInfo

```typescript
interface ProgressInfo {
  completed: number;
  total: number;
  currentUrl: string;
}
```

---

## Classes

### BrowserPool

Manages a pool of Playwright browser instances for efficient scraping.

```typescript
import { BrowserPool } from "@vakra-dev/reader";

const pool = new BrowserPool({ size: 5 });
await pool.initialize();

const result = await pool.withBrowser(async (page) => {
  await page.goto("https://example.com");
  return await page.title();
});

await pool.shutdown();
```

#### Constructor

```typescript
new BrowserPool(config?: PoolConfig)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `size` | `number` | `2` | Number of browser instances |
| `retireAfterPages` | `number` | `100` | Recycle after N pages |
| `retireAfterMinutes` | `number` | `30` | Recycle after N minutes |
| `maxQueueSize` | `number` | `100` | Maximum pending requests |
| `healthCheckIntervalMs` | `number` | `300000` | Health check interval |

#### Methods

##### initialize()

Initialize the browser pool.

```typescript
await pool.initialize(): Promise<void>
```

##### withBrowser(fn)

Execute a function with an acquired browser, automatically releasing it after.

```typescript
await pool.withBrowser<T>(fn: (page: Page) => Promise<T>): Promise<T>
```

##### acquire()

Manually acquire a browser instance. Must be paired with `release()`.

```typescript
const page = await pool.acquire(): Promise<Page>
```

##### release(hero)

Release a browser instance back to the pool.

```typescript
await pool.release(page: Page): Promise<void>
```

##### healthCheck()

Check the health of all pool instances.

```typescript
const health = await pool.healthCheck(): Promise<HealthCheckResult>
```

##### getStats()

Get current pool statistics.

```typescript
const stats = pool.getStats(): PoolStats
```

##### shutdown()

Shutdown all browser instances.

```typescript
await pool.shutdown(): Promise<void>
```

---

## Formatter Functions

### formatToMarkdown(pages, baseUrl, scrapedAt, duration, metadata?)

Convert scraped pages to Markdown format.

```typescript
import { formatToMarkdown } from "@vakra-dev/reader";

const markdown = formatToMarkdown(
  pages,
  "https://example.com",
  new Date().toISOString(),
  1500,
  metadata
);
```

---

### formatToHTML(pages, baseUrl, scrapedAt, duration, metadata?)

Convert scraped pages to a complete HTML document.

```typescript
import { formatToHTML } from "@vakra-dev/reader";

const html = formatToHTML(
  pages,
  "https://example.com",
  new Date().toISOString(),
  1500,
  metadata
);
```


---

## Utility Functions

### cleanContent(html)

Remove navigation, ads, scripts, and other non-content elements from HTML.

```typescript
import { cleanContent } from "@vakra-dev/reader";

const cleanHtml = cleanContent(rawHtml);
```

---

### extractMetadata(html)

Extract metadata from HTML including Open Graph and Twitter cards.

```typescript
import { extractMetadata } from "@vakra-dev/reader";

const metadata = extractMetadata(html);
console.log(metadata.title);
console.log(metadata.openGraph?.image);
```

---

## Default Values

```typescript
const DEFAULT_OPTIONS = {
  formats: ["markdown"],
  onlyMainContent: true,
  timeoutMs: 30000,
  batchConcurrency: 1,
  batchTimeoutMs: 300000,
  verbose: false,
  showChrome: false,
};

const DEFAULT_CRAWL_OPTIONS = {
  depth: 1,
  maxPages: 20,
  scrape: false,
  delayMs: 1000,
  formats: ["markdown", "html"],
  scrapeConcurrency: 2,
  verbose: false,
  showChrome: false,
};

const DEFAULT_POOL_CONFIG = {
  size: 2,
  retireAfterPages: 100,
  retireAfterMinutes: 30,
  maxQueueSize: 100,
  healthCheckIntervalMs: 300000,
};
```

---

## See Also

- [Getting Started](getting-started.md) - Quick start guide
- [Architecture](architecture.md) - System design
- [Browser Pool Guide](guides/browser-pool.md) - Pool management
- [Cloudflare Bypass Guide](guides/cloudflare-bypass.md) - Challenge handling
