# Browser Sessions

Browser sessions launch a stealthed Chrome and return a CDP (Chrome DevTools Protocol) WebSocket URL. You connect Playwright, Puppeteer, or any CDP client and get full browser automation with anti-bot stealth active.

## When to Use Browser Sessions

| Use case | Primitive |
|----------|-----------|
| Extract content from a URL → markdown | `scrape()` |
| Discover pages on a site | `crawl()` |
| Click buttons, fill forms, navigate multi-page flows | `browser()` |
| Scrape pages behind login/auth | `browser()` |
| Take screenshots, generate PDFs | `browser()` |
| Run existing Playwright/Puppeteer scripts with stealth | `browser()` |

## Quick Start

```typescript
import { ReaderClient } from "@vakra-dev/reader";
import { chromium } from "playwright-core";

const reader = new ReaderClient();

// Create a session
const session = await reader.browser();

// Connect Playwright - one-line change from local scripts
const browser = await chromium.connectOverCDP(session.wsEndpoint);
const context = await browser.newContext();
const page = await context.newPage();

// Use Playwright normally
await page.goto("https://example.com");
console.log(await page.title());

// Cleanup
await browser.close();
await session.close();
await reader.close();
```

## Stealth Features

Every browser session has these anti-bot features active automatically:

| Feature | What it does |
|---------|-------------|
| `navigator.webdriver = false` | Hides the automation flag that most bot detectors check first |
| Navigator spoofing | Realistic `deviceMemory`, `hardwareConcurrency`, `platform` values |
| WebGL/Canvas fingerprinting | Randomized rendering signatures |
| WebRTC IP masking | Prevents real IP leaks through WebRTC connections |
| Chrome plugin array | Simulates real Chrome extension presence |
| Permission API behavior | Matches real Chrome permission responses |

These are injected at the browser level via `Page.addScriptToEvaluateOnNewDocument` and apply to all pages, including pages created by Playwright/Puppeteer.

## Connecting with Playwright

```typescript
import { chromium } from "playwright-core";

const session = await reader.browser();
const browser = await chromium.connectOverCDP(session.wsEndpoint);
const context = await browser.newContext();
const page = await context.newPage();

// Full Playwright API available
await page.goto("https://example.com");
await page.click("#login-button");
await page.fill("#email", "user@example.com");
await page.screenshot({ path: "screenshot.png" });
await page.pdf({ path: "page.pdf" });

const cookies = await context.cookies();
```

Install: `npm install playwright-core`

## Connecting with Puppeteer

```typescript
import { connect } from "puppeteer-core";

const session = await reader.browser();
const browser = await connect({
  browserWSEndpoint: session.wsEndpoint,
  defaultViewport: null,
});

const page = await browser.newPage();
await page.goto("https://example.com");
console.log(await page.title());
```

Install: `npm install puppeteer-core`

## Connecting with Raw CDP

For any language or tool that speaks the Chrome DevTools Protocol:

```typescript
import WebSocket from "ws";

const session = await reader.browser();
const ws = new WebSocket(session.wsEndpoint);

// Create a page target
const target = await sendCDP(ws, "Target.createTarget", { url: "about:blank" });

// Attach and navigate
const attached = await sendCDP(ws, "Target.attachToTarget", {
  targetId: target.targetId,
  flatten: true,
});

await sendPageCDP(ws, attached.sessionId, "Page.navigate", {
  url: "https://example.com",
});
```

## Session Lifecycle

```
reader.browser()
  │
  ├── Launches Chrome with stealth (Playwright emulation scripts)
  ├── Extracts CDP WebSocket URL
  ├── Starts auto-close timeout (default: 5 minutes)
  │
  ▼
session.wsEndpoint
  │
  ├── Connect Playwright/Puppeteer
  ├── Navigate, interact, extract
  │
  ▼
session.close()  OR  timeout expires
  │
  └── Chrome process terminated, resources released
```

### Timeout

Sessions auto-close after `timeoutMs` (default: 300,000ms = 5 minutes). Set a longer timeout for extended automation:

```typescript
const session = await reader.browser({
  timeoutMs: 600_000, // 10 minutes
});
```

### Cleanup

Always close sessions when done to release Chrome processes:

```typescript
try {
  const session = await reader.browser();
  // ... use session ...
} finally {
  await session.close();
}
```

## CLI Usage

```bash
# Create a session (prints wsEndpoint JSON, blocks until Ctrl+C)
npx reader browser create

# Create with options
npx reader browser create --timeout 60000 --show-chrome

# List active sessions (daemon mode)
npx reader browser list

# Stop a session
npx reader browser stop <sessionId>
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `proxy` | `ProxyConfig` | - | Proxy to route browser traffic through |
| `proxyTier` | `ProxyTier` | - | Use a proxy from the configured pool tier |
| `showChrome` | `boolean` | `false` | Show the browser window |
| `timeoutMs` | `number` | `300000` | Session lifetime (auto-closes after) |
| `verbose` | `boolean` | `false` | Enable verbose logging |

## Notes

- Each session launches its own Chrome process (~300MB memory)
- Sessions are isolated from the scrape/crawl browser pool
- Stealth is provided by Playwright-level emulation scripts injected at browser launch
- Selenium/chromedriver is not supported (requires exclusive Chrome access). Use Playwright, Puppeteer, or raw CDP instead.
