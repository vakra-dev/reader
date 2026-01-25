# Troubleshooting

This guide covers common issues and their solutions when using Reader.

## Quick Diagnostics

Before diving into specific issues, try these debugging steps:

```bash
# Enable verbose logging
npx reader scrape https://example.com -v

# Show the browser window to see what's happening
npx reader scrape https://example.com --show-chrome

# Check Node.js version (should be >= 18)
node --version
```

## Common Errors

### Chrome/Chromium Not Found

**Error:**
```
Error: Could not find Chrome installation
```

**Cause:** Hero needs Chrome/Chromium to run. It tries to download it automatically on first run.

**Solutions:**

1. **Let Hero download Chrome:**
   ```bash
   # Clear any cached downloads and try again
   rm -rf ~/.cache/ulixee
   npx reader scrape https://example.com
   ```

2. **Install Chrome manually (Ubuntu/Debian):**
   ```bash
   sudo apt-get update
   sudo apt-get install -y chromium-browser
   ```

3. **Install Chrome manually (macOS):**
   ```bash
   brew install --cask chromium
   ```

4. **Point to existing Chrome:**
   ```bash
   export CHROME_PATH=/usr/bin/chromium-browser
   # or on macOS
   export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
   ```

### Connection Refused (ECONNREFUSED)

**Error:**
```
Error: connect ECONNREFUSED 127.0.0.1:9222
```

**Cause:** Hero couldn't start or connect to Chrome.

**Solutions:**

1. **Check if Chrome is running:**
   ```bash
   ps aux | grep chrome
   # Kill any zombie processes
   pkill -f chrome
   ```

2. **Check for port conflicts:**
   ```bash
   lsof -i :9222
   ```

3. **Try with a fresh browser instance:**
   ```typescript
   const reader = new ReaderClient({ showChrome: true });
   const result = await reader.scrape({
     urls: ["https://example.com"],
   });
   await reader.close();
   ```

### Request Timeout

**Error:**
```
Error: Navigation timeout of 30000 ms exceeded
```

**Cause:** The page took too long to load, or Cloudflare challenge took too long to resolve.

**Solutions:**

1. **Increase timeout:**
   ```typescript
   const reader = new ReaderClient();
   const result = await reader.scrape({
     urls: ["https://example.com"],
     timeoutMs: 60000,  // 60 seconds
   });
   await reader.close();
   ```

2. **For batch operations, increase batch timeout:**
   ```typescript
   const reader = new ReaderClient();
   const result = await reader.scrape({
     urls: [...manyUrls],
     batchTimeoutMs: 600000,  // 10 minutes total
   });
   await reader.close();
   ```

3. **Check if the site is accessible:**
   ```bash
   curl -I https://example.com
   ```

### Cloudflare Block (403/1020)

**Error:**
```
Error: Access denied (Error code 1020)
```

**Cause:** Cloudflare detected automated access and blocked the request.

**Solutions:**

1. **Use a proxy:**
   ```typescript
   const reader = new ReaderClient();
   const result = await reader.scrape({
     urls: ["https://example.com"],
     proxy: {
       type: "residential",
       host: "proxy.example.com",
       port: 8080,
       username: "username",
       password: "password",
     },
   });
   await reader.close();
   ```

2. **Add delays between requests:**
   ```typescript
   const reader = new ReaderClient();
   const result = await reader.crawl({
     url: "https://example.com",
     delayMs: 3000,  // 3 seconds between requests
   });
   await reader.close();
   ```

3. **Try a different user agent:**
   ```typescript
   const reader = new ReaderClient();
   const result = await reader.scrape({
     urls: ["https://example.com"],
     userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
   });
   await reader.close();
   ```

4. **Enable verbose mode to see challenge detection:**
   ```typescript
   const reader = new ReaderClient({ verbose: true, showChrome: true });
   const result = await reader.scrape({
     urls: ["https://example.com"],
   });
   await reader.close();
   ```

### Memory Issues

**Error:**
```
FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory
```

**Cause:** Too many browser instances or large pages consuming memory.

**Solutions:**

1. **Reduce concurrency:**
   ```typescript
   const reader = new ReaderClient();
   const result = await reader.scrape({
     urls: [...manyUrls],
     batchConcurrency: 2,  // Lower concurrency
   });
   await reader.close();
   ```

2. **Increase Node.js memory:**
   ```bash
   NODE_OPTIONS="--max-old-space-size=4096" npx reader scrape ...
   ```

3. **Use browser pool recycling (happens automatically, but you can tune it):**
   ```typescript
   import { BrowserPool } from "@vakra-dev/reader";

   const pool = new BrowserPool({
     size: 2,
     retireAfterPages: 50,  // Recycle browsers more frequently
   });
   ```

### ESM/CommonJS Issues

**Error:**
```
SyntaxError: Cannot use import statement outside a module
```

**Cause:** Reader is ESM-only, but your project is using CommonJS.

**Solutions:**

1. **Add to package.json:**
   ```json
   {
     "type": "module"
   }
   ```

2. **Or use .mjs extension:**
   ```bash
   mv script.js script.mjs
   node script.mjs
   ```

3. **Or use dynamic import in CommonJS:**
   ```javascript
   // script.cjs
   async function main() {
     const { scrape } = await import("@vakra-dev/reader");
     // ...
   }
   main();
   ```

### "Bun runtime not supported"

**Error:**
```
Error: Hero doesn't work with Bun runtime
```

**Cause:** Hero requires Node.js runtime and is not compatible with Bun.

**Solution:** Use Node.js to run your scripts:

```bash
# Use npx tsx
npx tsx script.ts

# or node with loader
node --loader tsx script.ts
```

## Debugging Tips

### Enable Verbose Logging

```typescript
const reader = new ReaderClient({ verbose: true });
const result = await reader.scrape({
  urls: ["https://example.com"],
});
await reader.close();
```

This shows:
- Cloudflare challenge detection
- Page navigation events
- Timing information
- Error details

### Show Browser Window

```typescript
const reader = new ReaderClient({ showChrome: true });
const result = await reader.scrape({
  urls: ["https://example.com"],
});
await reader.close();
```

This opens a visible Chrome window so you can see:
- What the page looks like
- Cloudflare challenges appearing
- JavaScript errors in DevTools

### Check Challenge Detection

```typescript
import { detectChallenge } from "@vakra-dev/reader";

// In your scraping logic
const detection = await detectChallenge(hero);
console.log("Challenge detected:", detection.isChallenge);
console.log("Challenge type:", detection.type);
console.log("Detection signals:", detection.signals);
```

### Log Progress

```typescript
const reader = new ReaderClient();
const result = await reader.scrape({
  urls: manyUrls,
  batchConcurrency: 3,
  onProgress: ({ completed, total, currentUrl }) => {
    console.log(`[${completed}/${total}] ${currentUrl}`);
  },
});
await reader.close();
```

## Performance Issues

### Slow Scraping

1. **Increase concurrency (if resources allow):**
   ```typescript
   batchConcurrency: 5  // Default is 1
   ```

2. **Use browser pool for repeated scrapes:**
   ```typescript
   import { BrowserPool } from "@vakra-dev/reader";

   const pool = new BrowserPool({ size: 5 });
   await pool.initialize();

   // Reuse pool for multiple operations
   for (const url of urls) {
     await pool.withBrowser(async (hero) => {
       await hero.goto(url);
       // ...
     });
   }

   await pool.shutdown();
   ```

3. **Use shared Hero Core for production:**
   See [Production Server Guide](deployment/production-server.md)

### High Memory Usage

1. **Reduce pool size:**
   ```typescript
   const pool = new BrowserPool({ size: 2 });
   ```

2. **Enable more aggressive recycling:**
   ```typescript
   const pool = new BrowserPool({
     size: 3,
     retireAfterPages: 30,      // Default: 100
     retireAfterMinutes: 15,    // Default: 30
   });
   ```

3. **Process URLs in smaller batches:**
   ```typescript
   const reader = new ReaderClient();
   const batchSize = 10;
   for (let i = 0; i < urls.length; i += batchSize) {
     const batch = urls.slice(i, i + batchSize);
     await reader.scrape({ urls: batch, batchConcurrency: 3 });
     // Allow garbage collection between batches
     await new Promise(r => setTimeout(r, 1000));
   }
   await reader.close();
   ```

## Site-Specific Issues

### JavaScript-Heavy Sites

Some sites require waiting for JavaScript to render:

```typescript
const reader = new ReaderClient();
const result = await reader.scrape({
  urls: ["https://spa-site.com"],
  waitForSelector: ".main-content",  // Wait for this element
  timeoutMs: 60000,
});
await reader.close();
```

### Sites with Infinite Scroll

Crawling may not discover all content. Consider:

1. Limiting depth and using specific URL patterns
2. Using the API directly with custom scroll logic

### Login-Protected Content

Reader doesn't handle authentication directly. Options:

1. Use cookies from an authenticated session
2. Build custom authentication logic using the Browser Pool
3. Use a headless browser automation tool for login, then Reader for scraping

## Getting More Help

1. **Check the logs** with `-v` flag
2. **Search existing issues** on [GitHub](https://github.com/vakra-dev/reader/issues)
3. **Open a new issue** with:
   - Node.js version
   - Reader version
   - Operating system
   - Error message and stack trace
   - Minimal reproduction steps

## Related Guides

- [Getting Started](getting-started.md)
- [Cloudflare Bypass](guides/cloudflare-bypass.md)
- [Browser Pool](guides/browser-pool.md)
- [Proxy Configuration](guides/proxy-configuration.md)
