# Basic Examples

Simple examples demonstrating core Reader functionality.

## Prerequisites

Before running examples, start Ulixee Cloud in a separate terminal:

```bash
npx @ulixee/cloud start
```

For production server usage with shared Core, see [examples/production/express-server](../production/express-server/).

## Examples

### basic-scrape.ts

Scrape a single URL and display the results.

```bash
npx tsx basic-scrape.ts
```

### batch-scrape.ts

Scrape multiple URLs concurrently.

```bash
npx tsx batch-scrape.ts
```

### crawl-website.ts

Crawl a website to discover and scrape pages.

```bash
# Crawl example.com
npx tsx crawl-website.ts

# Crawl a specific URL
npx tsx crawl-website.ts https://docs.example.com
```

### all-formats.ts

Output content in all supported formats (markdown, html).

```bash
npx tsx all-formats.ts
```

### with-proxy.ts

Scrape using a proxy server.

```bash
# Set proxy URL
export PROXY_URL="http://user:pass@proxy.example.com:8080"
npx tsx with-proxy.ts
```

## Running Examples

1. Install dependencies in the examples folder:
   ```bash
   cd examples
   npm install
   ```

2. Run any example:
   ```bash
   npx tsx <example-name>.ts
   ```
