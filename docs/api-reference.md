# API Reference

Complete API documentation for Reader.

## ReaderClient (Recommended)

The recommended way to use Reader. Manages HeroCore lifecycle automatically, reuses connections efficiently, and auto-closes on process exit.

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient({ verbose: true });

// Scrape URLs
const result = await reader.scrape({
  urls: ["https://example.com"],
  formats: ["markdown", "text"],
});

// Crawl a website
const crawlResult = await reader.crawl({
  url: "https://example.com",
  depth: 2,
});

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
| `proxies` | `ProxyConfig[]` | - | List of proxies to rotate through |
| `proxyRotation` | `"round-robin" \| "random"` | `"round-robin"` | Proxy rotation strategy |

#### BrowserPoolConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `size` | `number` | `2` | Number of browser instances |
| `retireAfterPages` | `number` | `100` | Retire browser after N page loads |
| `retireAfterMinutes` | `number` | `30` | Retire browser after N minutes |
| `maxQueueSize` | `number` | `100` | Maximum pending requests in queue |

### Methods

#### start()

Pre-initialize HeroCore. Called automatically on first scrape/crawl.

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

For advanced use cases where you need custom HeroCore management, you can use the direct functions. Note that without `connectionToCore`, each call spawns a new HeroCore instance which is less efficient.

### scrape(options)

Scrape one or more URLs and return content in specified formats.

```typescript
import { scrape } from "@vakra-dev/reader";

const result = await scrape({
  urls: ["https://example.com"],
  formats: ["markdown", "text"],
});
```

#### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `urls` | `string[]` | Yes | - | Array of URLs to scrape |
| `formats` | `FormatType[]` | No | `["markdown"]` | Output formats |
| `includeMetadata` | `boolean` | No | `true` | Include metadata in formatted output |
| `userAgent` | `string` | No | - | Custom user agent string |
| `timeoutMs` | `number` | No | `30000` | Request timeout in milliseconds |
| `includePatterns` | `string[]` | No | `[]` | URL patterns to include (regex) |
| `excludePatterns` | `string[]` | No | `[]` | URL patterns to exclude (regex) |
| `batchConcurrency` | `number` | No | `1` | URLs to process in parallel |
| `batchTimeoutMs` | `number` | No | `300000` | Total batch timeout |
| `maxRetries` | `number` | No | `2` | Retry attempts for failed URLs |
| `onProgress` | `ProgressCallback` | No | - | Progress callback function |
| `proxy` | `ProxyConfig` | No | - | Proxy configuration |
| `waitForSelector` | `string` | No | - | CSS selector to wait for |
| `verbose` | `boolean` | No | `false` | Enable verbose logging |
| `showChrome` | `boolean` | No | `false` | Show browser window |
| `connectionToCore` | `any` | No | - | Shared Hero Core connection |

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
  formats: ["markdown", "json"],
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
| `connectionToCore` | `any` | No | - | Shared Hero Core connection |

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
  formats?: Array<"markdown" | "html" | "json" | "text">;
  includeMetadata?: boolean;
  userAgent?: string;
  timeoutMs?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
  batchConcurrency?: number;
  batchTimeoutMs?: number;
  maxRetries?: number;
  onProgress?: (progress: ProgressInfo) => void;
  proxy?: ProxyConfig;
  waitForSelector?: string;
  verbose?: boolean;
  showChrome?: boolean;
  connectionToCore?: any;
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
  formats?: Array<"markdown" | "html" | "json" | "text">;
  scrapeConcurrency?: number;
  proxy?: ProxyConfig;
  userAgent?: string;
  verbose?: boolean;
  showChrome?: boolean;
  connectionToCore?: any;
}
```

### ProxyConfig

```typescript
interface ProxyConfig {
  url?: string;
  type?: "datacenter" | "residential";
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
  json?: string;
  text?: string;
  metadata: {
    baseUrl: string;
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

Manages a pool of Hero browser instances for efficient scraping.

```typescript
import { BrowserPool } from "@vakra-dev/reader";

const pool = new BrowserPool({ size: 5 });
await pool.initialize();

const result = await pool.withBrowser(async (hero) => {
  await hero.goto("https://example.com");
  return await hero.document.title;
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
await pool.withBrowser<T>(fn: (hero: Hero) => Promise<T>): Promise<T>
```

##### acquire()

Manually acquire a browser instance. Must be paired with `release()`.

```typescript
const hero = await pool.acquire(): Promise<Hero>
```

##### release(hero)

Release a browser instance back to the pool.

```typescript
await pool.release(hero: Hero): Promise<void>
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

## Cloudflare Functions

### detectChallenge(hero)

Detect if a Cloudflare challenge is present on the current page.

```typescript
import { detectChallenge } from "@vakra-dev/reader";

const detection = await detectChallenge(hero);

if (detection.isChallenge) {
  console.log("Challenge type:", detection.type);
  console.log("Signals:", detection.signals);
}
```

#### Returns

```typescript
interface ChallengeDetection {
  isChallenge: boolean;
  type: "js_challenge" | "turnstile" | "captcha" | "blocked" | null;
  signals: Array<{
    type: "dom" | "text" | "url";
    value: string;
  }>;
}
```

---

### waitForChallengeResolution(hero, options)

Wait for a Cloudflare challenge to be resolved.

```typescript
import { waitForChallengeResolution } from "@vakra-dev/reader";

const result = await waitForChallengeResolution(hero, {
  maxWaitMs: 45000,
  pollIntervalMs: 500,
  verbose: true,
  initialUrl: await hero.url,
});

if (result.resolved) {
  console.log(`Resolved via ${result.method} in ${result.waitedMs}ms`);
}
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxWaitMs` | `number` | `45000` | Maximum wait time |
| `pollIntervalMs` | `number` | `500` | Polling interval |
| `verbose` | `boolean` | `false` | Enable logging |
| `initialUrl` | `string` | - | Starting URL for redirect detection |

#### Returns

```typescript
interface ChallengeResolutionResult {
  resolved: boolean;
  method?: "redirect" | "element_removal";
  waitedMs: number;
}
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

### formatToJson(pages, baseUrl, scrapedAt, duration, metadata?)

Convert scraped pages to structured JSON.

```typescript
import { formatToJson } from "@vakra-dev/reader";

const json = formatToJson(
  pages,
  "https://example.com",
  new Date().toISOString(),
  1500,
  metadata
);
```

---

### formatToText(pages, baseUrl, scrapedAt, duration, metadata?)

Convert scraped pages to plain text.

```typescript
import { formatToText } from "@vakra-dev/reader";

const text = formatToText(
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
  includeMetadata: true,
  timeoutMs: 30000,
  includePatterns: [],
  excludePatterns: [],
  batchConcurrency: 1,
  batchTimeoutMs: 300000,
  maxRetries: 2,
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
