<p align="center">
  <img src="docs/assets/logo.png" alt="Reader Logo" width="200" />
</p>

<h1 align="center">Reader</h1>

<p align="center">
  <strong>Open-source, production-grade web scraping engine built for LLMs.</strong>
</p>

<p align="center">
  Scrape and crawl the entire web, clean markdown, ready for your agents.
</p>

<p align="center">
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License: Apache 2.0"></a>
  <a href="https://www.npmjs.com/package/@vakra-dev/reader"><img src="https://img.shields.io/npm/v/@vakra-dev/reader.svg" alt="npm version"></a>
  <a href="https://github.com/vakra-dev/reader/stargazers"><img src="https://img.shields.io/github/stars/vakra-dev/reader.svg?style=social" alt="GitHub stars"></a>
</p>

<p align="center">
  If you find Reader useful, please consider giving it a star on GitHub! It helps others discover the project.
</p>

## The Problem

Building agents that need web access is frustrating. You piece together Puppeteer, add stealth plugins, fight Cloudflare, manage proxies and it still breaks in production.

Because production grade web scraping isn't about rendering a page and converting HTML to markdown. It's about everything underneath:

| Layer                    | What it actually takes                                              |
| ------------------------ | ------------------------------------------------------------------- |
| **Browser architecture** | Managing browser instances at scale, not one-off scripts            |
| **Anti-bot bypass**      | Cloudflare, Turnstile, JS challenges, they all block naive scrapers |
| **TLS fingerprinting**   | Real browsers have fingerprints. Puppeteer doesn't. Sites know.     |
| **Proxy infrastructure** | Datacenter vs residential, rotation strategies, sticky sessions     |
| **Resource management**  | Browser pooling, memory limits, graceful recycling                  |
| **Reliability**          | Rate limiting, retries, timeouts, caching, graceful degradation     |

I built **Reader**, a production-grade web scraping engine on top of [Ulixee Hero](https://ulixee.org/), a headless browser designed for exactly this.

## The Solution

Two primitives. That's it.

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient();

// Scrape URLs → clean markdown
const result = await reader.scrape({ urls: ["https://example.com"] });
console.log(result.data[0].markdown);

// Crawl a site → discover + scrape pages
const pages = await reader.crawl({
  url: "https://example.com",
  depth: 2,
  scrape: true,
});
console.log(`Found ${pages.urls.length} pages`);
```

All the hard stuff, browser pooling, challenge detection, proxy rotation, retries, happens under the hood. You get clean markdown. Your agents get the web.

## Features

- **Cloudflare Bypass** - TLS fingerprinting, DNS over TLS, WebRTC masking
- **Multiple Formats** - Markdown, HTML, JSON, plain text
- **CLI & API** - Use from command line or programmatically
- **Browser Pool** - Auto-recycling, health monitoring, queue management
- **Concurrent Scraping** - Parallel URL processing with progress tracking
- **Website Crawling** - BFS link discovery with depth/page limits
- **Proxy Support** - Datacenter and residential with sticky sessions

## Installation

```bash
npm install @vakra-dev/reader
```

**Requirements:** Node.js >= 18

## Quick Start

### Basic Scrape

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient();

const result = await reader.scrape({
  urls: ["https://example.com"],
  formats: ["markdown", "text"],
});

console.log(result.data[0].markdown);
console.log(result.data[0].text);

await reader.close();
```

### Batch Scraping with Concurrency

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient();

const result = await reader.scrape({
  urls: ["https://example.com", "https://example.org", "https://example.net"],
  formats: ["markdown"],
  batchConcurrency: 3,
  onProgress: (progress) => {
    console.log(`${progress.completed}/${progress.total}: ${progress.currentUrl}`);
  },
});

console.log(`Scraped ${result.batchMetadata.successfulUrls} URLs`);

await reader.close();
```

### Crawling

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient();

const result = await reader.crawl({
  url: "https://example.com",
  depth: 2,
  maxPages: 20,
  scrape: true,
});

console.log(`Discovered ${result.urls.length} URLs`);
console.log(`Scraped ${result.scraped?.batchMetadata.successfulUrls} pages`);

await reader.close();
```

### With Proxy

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient();

const result = await reader.scrape({
  urls: ["https://example.com"],
  formats: ["markdown"],
  proxy: {
    type: "residential",
    host: "proxy.example.com",
    port: 8080,
    username: "username",
    password: "password",
    country: "us",
  },
});

await reader.close();
```

### With Proxy Rotation

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient({
  proxies: [
    { host: "proxy1.example.com", port: 8080, username: "user", password: "pass" },
    { host: "proxy2.example.com", port: 8080, username: "user", password: "pass" },
  ],
  proxyRotation: "round-robin", // or "random"
});

const result = await reader.scrape({
  urls: ["https://example.com", "https://example.org"],
  formats: ["markdown"],
  batchConcurrency: 2,
});

await reader.close();
```

### With Browser Pool Configuration

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient({
  browserPool: {
    size: 5, // 5 browser instances
    retireAfterPages: 50, // Recycle after 50 pages
    retireAfterMinutes: 15, // Recycle after 15 minutes
  },
  verbose: true,
});

const result = await reader.scrape({
  urls: manyUrls,
  batchConcurrency: 5,
});

await reader.close();
```

## CLI Reference

### Daemon Mode

For multiple requests, start a daemon to keep browser pool warm:

```bash
# Start daemon with browser pool
npx reader start --pool-size 5

# All subsequent commands auto-connect to daemon
npx reader scrape https://example.com
npx reader crawl https://example.com -d 2

# Check daemon status
npx reader status

# Stop daemon
npx reader stop

# Force standalone mode (bypass daemon)
npx reader scrape https://example.com --standalone
```

### `reader scrape <urls...>`

Scrape one or more URLs.

```bash
# Scrape a single URL
npx reader scrape https://example.com

# Scrape with multiple formats
npx reader scrape https://example.com -f markdown,text

# Scrape multiple URLs concurrently
npx reader scrape https://example.com https://example.org -c 2

# Save to file
npx reader scrape https://example.com -o output.md
```

| Option                   | Type   | Default      | Description                                               |
| ------------------------ | ------ | ------------ | --------------------------------------------------------- |
| `-f, --format <formats>` | string | `"markdown"` | Output formats (comma-separated: markdown,html,json,text) |
| `-o, --output <file>`    | string | stdout       | Output file path                                          |
| `-c, --concurrency <n>`  | number | `1`          | Parallel requests                                         |
| `-t, --timeout <ms>`     | number | `30000`      | Request timeout in milliseconds                           |
| `--batch-timeout <ms>`   | number | `300000`     | Total timeout for entire batch operation                  |
| `--proxy <url>`          | string | -            | Proxy URL (e.g., http://user:pass@host:port)              |
| `--user-agent <string>`  | string | -            | Custom user agent string                                  |
| `--show-chrome`          | flag   | -            | Show browser window for debugging                         |
| `--no-metadata`          | flag   | -            | Exclude metadata from output                              |
| `-v, --verbose`          | flag   | -            | Enable verbose logging                                    |

### `reader crawl <url>`

Crawl a website to discover pages.

```bash
# Crawl with default settings
npx reader crawl https://example.com

# Crawl deeper with more pages
npx reader crawl https://example.com -d 3 -m 50

# Crawl and scrape content
npx reader crawl https://example.com -d 2 --scrape

# Filter URLs with patterns
npx reader crawl https://example.com --include "blog/*" --exclude "admin/*"
```

| Option                   | Type   | Default      | Description                                     |
| ------------------------ | ------ | ------------ | ----------------------------------------------- |
| `-d, --depth <n>`        | number | `1`          | Maximum crawl depth                             |
| `-m, --max-pages <n>`    | number | `20`         | Maximum pages to discover                       |
| `-s, --scrape`           | flag   | -            | Also scrape content of discovered pages         |
| `-f, --format <formats>` | string | `"markdown"` | Output formats when scraping (comma-separated)  |
| `-o, --output <file>`    | string | stdout       | Output file path                                |
| `--delay <ms>`           | number | `1000`       | Delay between requests in milliseconds          |
| `-t, --timeout <ms>`     | number | -            | Total timeout for crawl operation               |
| `--include <patterns>`   | string | -            | URL patterns to include (comma-separated regex) |
| `--exclude <patterns>`   | string | -            | URL patterns to exclude (comma-separated regex) |
| `--proxy <url>`          | string | -            | Proxy URL (e.g., http://user:pass@host:port)    |
| `--user-agent <string>`  | string | -            | Custom user agent string                        |
| `--show-chrome`          | flag   | -            | Show browser window for debugging               |
| `-v, --verbose`          | flag   | -            | Enable verbose logging                          |

## API Reference

### `ReaderClient`

The recommended way to use Reader. Manages HeroCore lifecycle automatically.

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient({ verbose: true });

// Scrape
const result = await reader.scrape({ urls: ["https://example.com"] });

// Crawl
const crawlResult = await reader.crawl({ url: "https://example.com", depth: 2 });

// Close when done (optional - auto-closes on exit)
await reader.close();
```

#### Constructor Options

| Option          | Type                | Default         | Description                                      |
| --------------- | ------------------- | --------------- | ------------------------------------------------ |
| `verbose`       | `boolean`           | `false`         | Enable verbose logging                           |
| `showChrome`    | `boolean`           | `false`         | Show browser window for debugging                |
| `browserPool`   | `BrowserPoolConfig` | `undefined`     | Browser pool configuration (size, recycling)     |
| `proxies`       | `ProxyConfig[]`     | `undefined`     | Array of proxies for rotation                    |
| `proxyRotation` | `string`            | `"round-robin"` | Rotation strategy: `"round-robin"` or `"random"` |

#### BrowserPoolConfig

| Option               | Type     | Default | Description                         |
| -------------------- | -------- | ------- | ----------------------------------- |
| `size`               | `number` | `2`     | Number of browser instances in pool |
| `retireAfterPages`   | `number` | `100`   | Recycle browser after N page loads  |
| `retireAfterMinutes` | `number` | `30`    | Recycle browser after N minutes     |
| `maxQueueSize`       | `number` | `100`   | Max pending requests in queue       |

#### Methods

| Method            | Description                        |
| ----------------- | ---------------------------------- |
| `scrape(options)` | Scrape one or more URLs            |
| `crawl(options)`  | Crawl a website to discover pages  |
| `start()`         | Pre-initialize HeroCore (optional) |
| `isReady()`       | Check if client is initialized     |
| `close()`         | Close client and release resources |

### `scrape(options): Promise<ScrapeResult>`

Scrape one or more URLs. Can be used directly or via `ReaderClient`.

| Option             | Type                                              | Required | Default        | Description                                                     |
| ------------------ | ------------------------------------------------- | -------- | -------------- | --------------------------------------------------------------- |
| `urls`             | `string[]`                                        | Yes      | -              | Array of URLs to scrape                                         |
| `formats`          | `Array<"markdown" \| "html" \| "json" \| "text">` | No       | `["markdown"]` | Output formats                                                  |
| `includeMetadata`  | `boolean`                                         | No       | `true`         | Include URL, title, timestamp in output                         |
| `userAgent`        | `string`                                          | No       | -              | Custom user agent string                                        |
| `timeoutMs`        | `number`                                          | No       | `30000`        | Request timeout in milliseconds                                 |
| `includePatterns`  | `string[]`                                        | No       | `[]`           | URL patterns to include (regex strings)                         |
| `excludePatterns`  | `string[]`                                        | No       | `[]`           | URL patterns to exclude (regex strings)                         |
| `batchConcurrency` | `number`                                          | No       | `1`            | Number of URLs to process in parallel                           |
| `batchTimeoutMs`   | `number`                                          | No       | `300000`       | Total timeout for entire batch operation                        |
| `maxRetries`       | `number`                                          | No       | `2`            | Maximum retry attempts for failed URLs                          |
| `onProgress`       | `function`                                        | No       | -              | Progress callback: `({ completed, total, currentUrl }) => void` |
| `proxy`            | `ProxyConfig`                                     | No       | -              | Proxy configuration object                                      |
| `waitForSelector`  | `string`                                          | No       | -              | CSS selector to wait for before page is loaded                  |
| `verbose`          | `boolean`                                         | No       | `false`        | Enable verbose logging                                          |
| `showChrome`       | `boolean`                                         | No       | `false`        | Show Chrome window for debugging                                |
| `connectionToCore` | `any`                                             | No       | -              | Connection to shared Hero Core (for production)                 |

**Returns:** `Promise<ScrapeResult>`

```typescript
interface ScrapeResult {
  data: WebsiteScrapeResult[];
  batchMetadata: BatchMetadata;
}

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
  };
}

interface BatchMetadata {
  totalUrls: number;
  successfulUrls: number;
  failedUrls: number;
  scrapedAt: string;
  totalDuration: number;
  errors?: Array<{ url: string; error: string }>;
}
```

### `crawl(options): Promise<CrawlResult>`

Crawl a website to discover pages.

| Option              | Type                                              | Required | Default                | Description                                     |
| ------------------- | ------------------------------------------------- | -------- | ---------------------- | ----------------------------------------------- |
| `url`               | `string`                                          | Yes      | -                      | Single seed URL to start crawling from          |
| `depth`             | `number`                                          | No       | `1`                    | Maximum depth to crawl                          |
| `maxPages`          | `number`                                          | No       | `20`                   | Maximum pages to discover                       |
| `scrape`            | `boolean`                                         | No       | `false`                | Also scrape full content of discovered pages    |
| `delayMs`           | `number`                                          | No       | `1000`                 | Delay between requests in milliseconds          |
| `timeoutMs`         | `number`                                          | No       | -                      | Total timeout for entire crawl operation        |
| `includePatterns`   | `string[]`                                        | No       | -                      | URL patterns to include (regex strings)         |
| `excludePatterns`   | `string[]`                                        | No       | -                      | URL patterns to exclude (regex strings)         |
| `formats`           | `Array<"markdown" \| "html" \| "json" \| "text">` | No       | `["markdown", "html"]` | Output formats for scraped content              |
| `scrapeConcurrency` | `number`                                          | No       | `2`                    | Number of URLs to scrape in parallel            |
| `proxy`             | `ProxyConfig`                                     | No       | -                      | Proxy configuration object                      |
| `userAgent`         | `string`                                          | No       | -                      | Custom user agent string                        |
| `verbose`           | `boolean`                                         | No       | `false`                | Enable verbose logging                          |
| `showChrome`        | `boolean`                                         | No       | `false`                | Show Chrome window for debugging                |
| `connectionToCore`  | `any`                                             | No       | -                      | Connection to shared Hero Core (for production) |

**Returns:** `Promise<CrawlResult>`

```typescript
interface CrawlResult {
  urls: CrawlUrl[];
  scraped?: ScrapeResult;
  metadata: CrawlMetadata;
}

interface CrawlUrl {
  url: string;
  title: string;
  description: string | null;
}

interface CrawlMetadata {
  totalUrls: number;
  maxDepth: number;
  totalDuration: number;
  seedUrl: string;
}
```

### ProxyConfig

| Option     | Type                            | Required | Default | Description                                             |
| ---------- | ------------------------------- | -------- | ------- | ------------------------------------------------------- |
| `url`      | `string`                        | No       | -       | Full proxy URL (takes precedence over other fields)     |
| `type`     | `"datacenter" \| "residential"` | No       | -       | Proxy type                                              |
| `host`     | `string`                        | No       | -       | Proxy host                                              |
| `port`     | `number`                        | No       | -       | Proxy port                                              |
| `username` | `string`                        | No       | -       | Proxy username                                          |
| `password` | `string`                        | No       | -       | Proxy password                                          |
| `country`  | `string`                        | No       | -       | Country code for residential proxies (e.g., 'us', 'uk') |

## Advanced Usage

### Browser Pool

For high-volume scraping, use the browser pool directly:

```typescript
import { BrowserPool } from "@vakra-dev/reader";

const pool = new BrowserPool({ size: 5 });
await pool.initialize();

// Use withBrowser for automatic acquire/release
const title = await pool.withBrowser(async (hero) => {
  await hero.goto("https://example.com");
  return await hero.document.title;
});

// Check pool health
const health = await pool.healthCheck();
console.log(`Pool healthy: ${health.healthy}`);

await pool.shutdown();
```

### Shared Hero Core (Production)

For production servers, use a shared Hero Core to avoid spawning new Chrome for each request:

```typescript
import HeroCore from "@ulixee/hero-core";
import { TransportBridge } from "@ulixee/net";
import { ConnectionToHeroCore } from "@ulixee/hero";
import { scrape } from "@vakra-dev/reader";

// Initialize once at startup
const heroCore = new HeroCore();
await heroCore.start();

// Create connection for each request
function createConnection() {
  const bridge = new TransportBridge();
  heroCore.addConnection(bridge.transportToClient);
  return new ConnectionToHeroCore(bridge.transportToCore);
}

// Use in requests
const result = await scrape({
  urls: ["https://example.com"],
  connectionToCore: createConnection(),
});

// Shutdown on exit
await heroCore.close();
```

### Cloudflare Challenge Detection

```typescript
import { detectChallenge, waitForChallengeResolution } from "@vakra-dev/reader";

const detection = await detectChallenge(hero);

if (detection.isChallenge) {
  console.log(`Challenge detected: ${detection.type}`);

  const result = await waitForChallengeResolution(hero, {
    maxWaitMs: 45000,
    pollIntervalMs: 500,
    verbose: true,
    initialUrl: await hero.url,
  });

  if (result.resolved) {
    console.log(`Challenge resolved via ${result.method} in ${result.waitedMs}ms`);
  }
}
```

### Custom Formatters

```typescript
import { formatToMarkdown, formatToText, formatToHTML, formatToJson } from "@vakra-dev/reader";

// Format pages to different outputs
const markdown = formatToMarkdown(pages, baseUrl, scrapedAt, duration, metadata);
const text = formatToText(pages, baseUrl, scrapedAt, duration, metadata);
const html = formatToHTML(pages, baseUrl, scrapedAt, duration, metadata);
const json = formatToJson(pages, baseUrl, scrapedAt, duration, metadata);
```

## How It Works

### Cloudflare Bypass

Reader uses [Ulixee Hero](https://ulixee.org/), a headless browser with advanced anti-detection:

1. **TLS Fingerprinting** - Emulates real Chrome browser fingerprints
2. **DNS over TLS** - Uses Cloudflare DNS (1.1.1.1) to mimic Chrome behavior
3. **WebRTC IP Masking** - Prevents IP leaks
4. **Multi-Signal Detection** - Detects challenges using DOM elements and text patterns
5. **Dynamic Waiting** - Polls for challenge resolution with URL redirect detection

### Browser Pool

- **Auto-Recycling** - Browsers recycled after 100 requests or 30 minutes
- **Health Monitoring** - Background health checks every 5 minutes
- **Request Queuing** - Queues requests when pool is full (max 100)

## Documentation

| Guide                                      | Description                    |
| ------------------------------------------ | ------------------------------ |
| [Getting Started](docs/getting-started.md) | Detailed setup and first steps |
| [Architecture](docs/architecture.md)       | System design and data flow    |
| [API Reference](docs/api-reference.md)     | Complete API documentation     |
| [Troubleshooting](docs/troubleshooting.md) | Common errors and solutions    |

### Guides

| Guide                                                     | Description                   |
| --------------------------------------------------------- | ----------------------------- |
| [Cloudflare Bypass](docs/guides/cloudflare-bypass.md)     | How antibot bypass works      |
| [Proxy Configuration](docs/guides/proxy-configuration.md) | Setting up proxies            |
| [Browser Pool](docs/guides/browser-pool.md)               | Production browser management |
| [Output Formats](docs/guides/output-formats.md)           | Understanding output formats  |

### Deployment

| Guide                                                     | Description                |
| --------------------------------------------------------- | -------------------------- |
| [Docker](docs/deployment/docker.md)                       | Container deployment       |
| [Production Server](docs/deployment/production-server.md) | Express + shared Hero Core |
| [Job Queues](docs/deployment/job-queues.md)               | BullMQ async scheduling    |
| [Serverless](docs/deployment/serverless.md)               | Lambda, Vercel, Workers    |

### Examples

| Example                                                      | Description                                |
| ------------------------------------------------------------ | ------------------------------------------ |
| [Basic Scraping](examples/basic/basic-scrape.ts)             | Simple single-URL scraping                 |
| [Batch Scraping](examples/basic/batch-scrape.ts)             | Concurrent multi-URL scraping              |
| [Browser Pool Config](examples/basic/browser-pool-config.ts) | Configure browser pool for high throughput |
| [Proxy Pool](examples/basic/proxy-pool.ts)                   | Proxy rotation with multiple proxies       |
| [Cloudflare Bypass](examples/basic/cloudflare-bypass.ts)     | Scrape Cloudflare-protected sites          |
| [All Formats](examples/basic/all-formats.ts)                 | Output in markdown, html, json, text       |
| [Crawl Website](examples/basic/crawl-website.ts)             | Crawl and discover pages                   |
| [AI Tools](examples/ai-tools/)                               | OpenAI, Anthropic, LangChain integrations  |
| [Production](examples/production/)                           | Express server, job queues                 |
| [Deployment](examples/deployment/)                           | Docker, Lambda, Vercel                     |

## Development

```bash
# Install dependencies
npm install

# Run linting
npm run lint

# Format code
npm run format

# Type check
npm run typecheck

# Find TODOs
npm run todo
```

## Contributing

Contributions welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[Apache 2.0](LICENSE) - See LICENSE for details.

## Citation

If you use Reader in your research or project, please cite it:

```bibtex
@software{reader2026,
  author = {Kaul, Nihal},
  title = {Reader: Open-source, production-grade web scraping engine built for LLMs},
  year = {2026},
  publisher = {GitHub},
  url = {https://github.com/vakra-dev/reader}
}
```

## Support

- [GitHub Issues](https://github.com/vakra-dev/reader/issues)
- [Documentation](https://github.com/vakra-dev/reader)
