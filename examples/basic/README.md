# Basic Examples

Simple examples demonstrating core Reader functionality.

## Running Examples

All commands run from the `reader` directory. Requires Node v22+ (`nvm use v22`).

```bash
npx tsx --tsconfig examples/tsconfig.json examples/basic/<example>.ts
```

If Hero's bundled Chrome binary isn't available (e.g. Apple Silicon), point to your local Chrome:

```bash
export CHROME_139_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

## Scraping

| Example | Description |
|---------|-------------|
| `basic-scrape.ts` | Scrape a single URL and display markdown output |
| `batch-scrape.ts` | Scrape multiple URLs concurrently with progress tracking |
| `all-formats.ts` | Output content in all supported formats (markdown, html) |

## Crawling

| Example | Description |
|---------|-------------|
| `crawl-website.ts` | Crawl a website to discover and optionally scrape pages |

## Browser Sessions

Browser sessions launch a stealthed Chrome and return a CDP WebSocket URL.
Connect with Playwright, Puppeteer, or any CDP client. Anti-bot stealth is
active (`webdriver=false`, navigator spoofing, WebRTC masking).

| Example | Description |
|---------|-------------|
| `browser-session.ts` | Playwright: navigate, extract data, screenshot |
| `browser-session-actions.ts` | Playwright: click, type, search, wait for elements |
| `browser-session-puppeteer.ts` | Puppeteer: same flow via `connect({ browserWSEndpoint })` |
| `browser-session-selenium.ts` | Raw CDP: direct WebSocket commands, no framework needed |

### Dependencies

```bash
npm install --save-dev playwright-core   # for Playwright examples
npm install --save-dev puppeteer-core    # for Puppeteer example
npm install --save-dev ws                # for raw CDP example
```

## Configuration

| Example | Description |
|---------|-------------|
| `with-proxy.ts` | Scrape using a proxy server |
| `proxy-pool.ts` | Rotate through multiple proxies |
| `browser-pool-config.ts` | Configure pool size, retirement, and queue limits |
| `cloudflare-bypass.ts` | Scrape a Cloudflare-protected site |
