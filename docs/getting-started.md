# Getting Started

This guide walks you through setting up Reader, verifying your installation, and running your first scrape.

## Prerequisites

- **Node.js >= 18** (v22 recommended)
- **npm** package manager

> **Note:** The Hero browser runtime requires Node.js. Always run your scripts with `node` or `npx tsx`.

## Installation

### From npm

```bash
npm install @vakra-dev/reader
```

### From source

```bash
git clone https://github.com/vakra-dev/reader.git
cd reader
npm install
npm run build
```

## Verify Installation

### Test the CLI

```bash
npx reader scrape https://example.com
```

You should see markdown output of the example.com page.

### Test the API

Create a file `test-scrape.ts`:

```typescript
import { ReaderClient } from "@vakra-dev/reader";

async function main() {
  const reader = new ReaderClient();

  const result = await reader.scrape({
    urls: ["https://example.com"],
    formats: ["markdown"],
  });

  console.log("Success:", result.batchMetadata.successfulUrls === 1);
  console.log("Content length:", result.data[0].markdown?.length);

  await reader.close();
}

main().catch(console.error);
```

Run it:

```bash
npx tsx test-scrape.ts
```

## Your First Scrape

### Single URL

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient();

const result = await reader.scrape({
  urls: ["https://news.ycombinator.com"],
  formats: ["markdown", "text"],
});

// Access the markdown content
console.log(result.data[0].markdown);

// Access metadata
console.log("Title:", result.data[0].metadata.website.title);
console.log("Duration:", result.data[0].metadata.duration, "ms");

await reader.close();
```

### Multiple URLs

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient();

const result = await reader.scrape({
  urls: [
    "https://example.com",
    "https://example.org",
    "https://example.net",
  ],
  formats: ["markdown"],
  batchConcurrency: 3,
  onProgress: ({ completed, total, currentUrl }) => {
    console.log(`[${completed}/${total}] Scraping: ${currentUrl}`);
  },
});

console.log(`Scraped ${result.batchMetadata.successfulUrls} URLs`);
console.log(`Failed: ${result.batchMetadata.failedUrls}`);

await reader.close();
```

### Crawl a Website

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient();

const result = await reader.crawl({
  url: "https://example.com",
  depth: 2,
  maxPages: 10,
  scrape: true,
});

console.log(`Discovered ${result.urls.length} URLs:`);
result.urls.forEach((page) => {
  console.log(`  - ${page.title}: ${page.url}`);
});

if (result.scraped) {
  console.log(`\nScraped ${result.scraped.batchMetadata.successfulUrls} pages`);
}

await reader.close();
```

## Understanding the Output

### ScrapeResult Structure

```typescript
interface ScrapeResult {
  // Array of scraped websites (one per URL)
  data: WebsiteScrapeResult[];

  // Metadata about the batch operation
  batchMetadata: {
    totalUrls: number;
    successfulUrls: number;
    failedUrls: number;
    scrapedAt: string;      // ISO timestamp
    totalDuration: number;  // milliseconds
    errors?: Array<{ url: string; error: string }>;
  };
}

interface WebsiteScrapeResult {
  // Content in requested formats
  markdown?: string;
  html?: string;
  json?: string;
  text?: string;

  // Metadata about this specific scrape
  metadata: {
    baseUrl: string;
    totalPages: number;
    scrapedAt: string;
    duration: number;
    website: WebsiteMetadata;  // Title, description, OG tags, etc.
  };
}
```

### CrawlResult Structure

```typescript
interface CrawlResult {
  // Discovered URLs with basic info
  urls: Array<{
    url: string;
    title: string;
    description: string | null;
  }>;

  // Full scrape results (only when scrape: true)
  scraped?: ScrapeResult;

  // Crawl operation metadata
  metadata: {
    totalUrls: number;
    maxDepth: number;
    totalDuration: number;
    seedUrl: string;
  };
}
```

## CLI Quick Reference

### Daemon Mode (Recommended for Multiple Requests)

```bash
# Start daemon (once, in a separate terminal or background)
npx reader start --pool-size 5

# Scrape (auto-detects and uses daemon if running)
npx reader scrape https://example.com

# Crawl (auto-detects and uses daemon if running)
npx reader crawl https://example.com -d 2

# Check daemon status
npx reader status

# Stop daemon
npx reader stop

# Force standalone mode (bypass daemon)
npx reader scrape https://example.com --standalone
```

### Scraping

```bash
# Scrape a URL to markdown
npx reader scrape https://example.com

# Scrape with multiple formats
npx reader scrape https://example.com -f markdown,text,json

# Scrape multiple URLs concurrently
npx reader scrape url1 url2 url3 -c 3

# Save output to file
npx reader scrape https://example.com -o output.md

# Enable verbose logging
npx reader scrape https://example.com -v

# Show browser window (debugging)
npx reader scrape https://example.com --show-chrome
```

### Crawling

```bash
# Crawl a website
npx reader crawl https://example.com -d 2 -m 20

# Crawl and scrape content
npx reader crawl https://example.com -d 2 --scrape
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LOG_LEVEL` | Logging level: `debug`, `info`, `warn`, `error` (default: `info`) |
| `NODE_ENV` | Set to `development` for pretty-printed logs |

## Common Issues

### "Chrome/Chromium not found"

Hero automatically downloads Chrome on first run. If this fails:

```bash
# Manually install Chrome dependencies (Ubuntu/Debian)
sudo apt-get install -y chromium-browser

# Or use the system Chrome
export CHROME_PATH=/usr/bin/chromium-browser
```

### "ECONNREFUSED" errors

This usually means the target site is blocking requests. Try:

1. Use a proxy: `--proxy http://user:pass@host:port`
2. Add delays between requests: `--delay 2000`
3. Use verbose mode to see what's happening: `-v`

### ESM/CommonJS issues

Reader is ESM-only. Make sure your `package.json` has:

```json
{
  "type": "module"
}
```

Or use the `.mjs` extension for your files.

## Next Steps

Based on your use case, explore these guides:

| Use Case | Guide |
|----------|-------|
| Understanding Cloudflare bypass | [Cloudflare Bypass](guides/cloudflare-bypass.md) |
| Setting up proxies | [Proxy Configuration](guides/proxy-configuration.md) |
| Production server deployment | [Production Server](deployment/production-server.md) |
| High-volume scraping | [Browser Pool](guides/browser-pool.md) |
| Docker deployment | [Docker](deployment/docker.md) |
| Serverless deployment | [Serverless](deployment/serverless.md) |

## Need Help?

- Check the [Troubleshooting Guide](troubleshooting.md)
- Browse [Examples](../examples/)
- Open an issue on [GitHub](https://github.com/vakra-dev/reader/issues)
