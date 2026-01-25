# Cloudflare Bypass Guide

This guide explains how Reader bypasses Cloudflare and other bot detection systems.

## Overview

Many websites use Cloudflare to protect against bots. Reader uses [Ulixee Hero](https://ulixee.org/) which employs multiple techniques to appear as a legitimate browser.

## How It Works

### 1. TLS Fingerprinting

Every browser has a unique TLS (HTTPS) fingerprint based on:
- Supported cipher suites
- TLS extensions order
- ALPN protocols

Hero emulates Chrome's exact TLS fingerprint, making connections indistinguishable from a real browser.

### 2. DNS over TLS

Chrome uses DNS over HTTPS/TLS to Cloudflare's 1.1.1.1 servers. Hero replicates this behavior, which Cloudflare can detect and uses as a trust signal.

### 3. WebRTC IP Masking

WebRTC can leak your real IP even behind a proxy. Hero masks WebRTC to prevent IP detection that could reveal automation.

### 4. JavaScript Environment

Hero creates a complete browser environment:
- Navigator properties match real Chrome
- WebGL fingerprints are realistic
- Canvas fingerprints are consistent
- Plugin arrays match real installations

## Challenge Types

Reader detects and handles these challenge types:

| Challenge | Detection | Bypass Method |
|-----------|-----------|---------------|
| **JS Challenge** | "Checking your browser" text | Wait for auto-resolution |
| **Turnstile** | Turnstile widget in DOM | Wait for user interaction simulation |
| **Under Attack Mode** | Interstitial page | Extended wait with polling |
| **CAPTCHA** | hCaptcha/reCAPTCHA widget | Cannot bypass (requires human) |
| **WAF Block** | 403/1020 error codes | Cannot bypass (IP blocked) |

## Detection API

You can manually check for challenges:

```typescript
import { detectChallenge } from "@vakra-dev/reader";

const detection = await detectChallenge(hero);

console.log("Is challenge:", detection.isChallenge);
console.log("Type:", detection.type);
console.log("Signals:", detection.signals);
```

### Detection Signals

The detector looks for multiple signals:

**DOM Signals:**
- `#challenge-form` - Main challenge container
- `.cf-browser-verification` - Verification widget
- `#turnstile-wrapper` - Turnstile CAPTCHA
- `#cf-hcaptcha-container` - hCaptcha container

**Text Signals:**
- "Checking your browser"
- "Please wait..."
- "DDoS protection by Cloudflare"
- "Ray ID:"

**URL Signals:**
- `/cdn-cgi/challenge-platform/`
- `__cf_chl_` parameters

## Resolution API

Wait for a challenge to be resolved:

```typescript
import { waitForChallengeResolution } from "@vakra-dev/reader";

const result = await waitForChallengeResolution(hero, {
  maxWaitMs: 45000,        // Maximum wait time
  pollIntervalMs: 500,     // Check every 500ms
  verbose: true,           // Log progress
  initialUrl: await hero.url,
});

if (result.resolved) {
  console.log(`Resolved via: ${result.method}`);
  console.log(`Wait time: ${result.waitedMs}ms`);
} else {
  console.log("Challenge not resolved within timeout");
}
```

### Resolution Methods

1. **Redirect Detection** - URL changes after challenge is solved
2. **Element Removal** - Challenge DOM elements disappear

## Improving Success Rate

### Use Residential Proxies

Cloudflare trusts residential IPs more than datacenter IPs:

```typescript
const reader = new ReaderClient();
const result = await reader.scrape({
  urls: ["https://protected-site.com"],
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

### Add Delays

Rate limiting makes your traffic look more human:

```typescript
const reader = new ReaderClient();

// For crawling
const result = await reader.crawl({
  url: "https://protected-site.com",
  delayMs: 3000,  // 3 seconds between requests
});

// For batch scraping, lower concurrency
const batchResult = await reader.scrape({
  urls: manyUrls,
  batchConcurrency: 1,  // One at a time
});

await reader.close();
```

### Rotate User Agents

Some sites track user agent patterns:

```typescript
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36...",
];

const reader = new ReaderClient();
const result = await reader.scrape({
  urls: ["https://example.com"],
  userAgent: userAgents[Math.floor(Math.random() * userAgents.length)],
});
await reader.close();
```

### Increase Timeout

Challenges can take 30+ seconds to resolve:

```typescript
const reader = new ReaderClient();
const result = await reader.scrape({
  urls: ["https://protected-site.com"],
  timeoutMs: 60000,  // 60 seconds
});
await reader.close();
```

## What Can't Be Bypassed

### CAPTCHAs

CAPTCHAs require human interaction. Reader cannot solve:
- hCaptcha
- reCAPTCHA
- Cloudflare Turnstile (interactive mode)

For these, consider:
- CAPTCHA solving services (2Captcha, Anti-Captcha)
- Manual solving workflows
- Alternative data sources

### IP Bans

If your IP is blocked by Cloudflare's WAF:
- You'll see 403 or 1020 errors
- No amount of browser emulation helps
- Solution: Use different IPs (proxies)

### Rate Limits

Excessive requests trigger blocks:
- Implement delays between requests
- Use multiple proxies
- Reduce concurrency

## Debugging Challenges

### Visual Debugging

See exactly what's happening:

```typescript
const reader = new ReaderClient({ showChrome: true, verbose: true });
const result = await reader.scrape({
  urls: ["https://protected-site.com"],
});
await reader.close();
```

### Check Detection Results

```typescript
import { detectChallenge } from "@vakra-dev/reader";

// After navigation
const detection = await detectChallenge(hero);
console.log(JSON.stringify(detection, null, 2));
```

### Monitor Network

Hero supports network monitoring:

```typescript
await pool.withBrowser(async (hero) => {
  hero.on("resource", (resource) => {
    if (resource.url.includes("cdn-cgi")) {
      console.log("Cloudflare resource:", resource.url);
    }
  });

  await hero.goto("https://protected-site.com");
});
```

## Best Practices

1. **Start with verbose mode** to understand what's happening
2. **Use residential proxies** for heavily protected sites
3. **Implement delays** to avoid triggering rate limits
4. **Handle failures gracefully** - not every request will succeed
5. **Rotate IPs** for large-scale scraping
6. **Respect robots.txt** when possible
7. **Cache results** to minimize repeat requests

## Example: Full Challenge Handling

```typescript
import { scrape, detectChallenge, waitForChallengeResolution } from "@vakra-dev/reader";
import { BrowserPool } from "@vakra-dev/reader";

async function scrapeWithChallengeHandling(url: string) {
  const pool = new BrowserPool({ size: 1 });
  await pool.initialize();

  try {
    return await pool.withBrowser(async (hero) => {
      // Navigate to page
      await hero.goto(url, { timeoutMs: 60000 });

      // Check for challenge
      const detection = await detectChallenge(hero);

      if (detection.isChallenge) {
        console.log(`Challenge detected: ${detection.type}`);

        // Wait for resolution
        const resolution = await waitForChallengeResolution(hero, {
          maxWaitMs: 45000,
          pollIntervalMs: 500,
          verbose: true,
          initialUrl: url,
        });

        if (!resolution.resolved) {
          throw new Error(`Challenge not resolved: ${detection.type}`);
        }

        console.log(`Challenge resolved in ${resolution.waitedMs}ms`);
      }

      // Extract content
      const html = await hero.document.body.innerHTML;
      const title = await hero.document.title;

      return { html, title };
    });
  } finally {
    await pool.shutdown();
  }
}
```

## Related Guides

- [Proxy Configuration](proxy-configuration.md) - Setting up proxies
- [Browser Pool](browser-pool.md) - Managing browser instances
- [Troubleshooting](../troubleshooting.md) - Common issues
