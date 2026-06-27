# Cloudflare Bypass Guide

This guide explains how Reader bypasses Cloudflare and other bot detection systems.

## Overview

Many websites use Cloudflare to protect against bots. Reader uses Playwright with stealth enhancements that employ multiple techniques to appear as a legitimate browser.

## How It Works

### 1. Fingerprint Generation

Every browser has a unique fingerprint based on:
- Navigator properties
- WebGL and Canvas signatures
- Plugin arrays and hardware info

Reader uses fingerprint-generator to produce realistic, consistent browser fingerprints that match real Chrome installations.

### 2. WebRTC IP Masking

WebRTC can leak your real IP even behind a proxy. Reader masks WebRTC to prevent IP detection that could reveal automation.

### 3. Stealth Scripts

Reader injects stealth scripts at page load to patch automation indicators:
- `navigator.webdriver = false`
- Realistic navigator properties
- Consistent canvas and WebGL fingerprints
- Plugin arrays matching real installations

### 4. Proxy Chain

Traffic is routed through proxy-chain for IP management and to avoid detection from IP-based signals.

## Challenge Types

Reader detects and handles these challenge types:

| Challenge | Detection | Bypass Method |
|-----------|-----------|---------------|
| **JS Challenge** | "Checking your browser" text | Wait for auto-resolution |
| **Turnstile** | Turnstile widget in DOM | Wait for user interaction simulation |
| **Under Attack Mode** | Interstitial page | Extended wait with polling |
| **CAPTCHA** | hCaptcha/reCAPTCHA widget | Cannot bypass (requires human) |
| **WAF Block** | 403/1020 error codes | Cannot bypass (IP blocked) |

## How Detection Works

Challenge detection and resolution is handled automatically by the engine. You don't need to call any detection functions manually - Reader detects and resolves challenges during every scrape.

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

## Resolution

The engine automatically resolves challenges using two methods:

1. **Redirect Detection** - URL changes after challenge is solved
2. **Element Removal** - Challenge DOM elements disappear

Resolution runs automatically during every scrape with a 45-second timeout.

## Improving Success Rate

### Use Residential Proxies

Cloudflare trusts residential IPs more than datacenter IPs:

```typescript
const reader = new ReaderClient();
const result = await reader.scrape({
  urls: ["https://protected-site.com"],
  proxy: {
    type: "premium",
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

### Verbose Mode

Enable verbose logging to see challenge detection and resolution in action:

```typescript
const reader = new ReaderClient({ verbose: true });
const result = await reader.scrape({
  urls: ["https://protected-site.com"],
});
await reader.close();
```

## Best Practices

1. **Start with verbose mode** to understand what's happening
2. **Use residential proxies** for heavily protected sites
3. **Implement delays** to avoid triggering rate limits
4. **Handle failures gracefully** - not every request will succeed
5. **Rotate IPs** for large-scale scraping
6. **Respect robots.txt** when possible
7. **Cache results** to minimize repeat requests

## Example: Scraping a Cloudflare-Protected Site

Challenge handling is automatic. Just scrape normally:

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient({
  proxyPools: {
    standard: [{ url: "http://user:pass@dc-proxy:8080" }],
    premium: [{ url: "http://user:pass@res-proxy:8080" }],
  },
});

// Reader auto-detects Cloudflare and escalates to residential proxy if needed
const result = await reader.scrape({
  urls: ["https://cloudflare-protected-site.com"],
  proxyMode: "standard", // or "premium" for anti-bot sites
});

console.log(result.data[0].markdown);
await reader.close();
```

## Related Guides

- [Proxy Configuration](proxy-configuration.md) - Setting up proxies
- [Browser Pool](browser-pool.md) - Managing browser instances
- [Troubleshooting](../troubleshooting.md) - Common issues
