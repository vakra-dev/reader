# Browser Pool Guide

This guide covers browser pool management for production-grade scraping.

## When to Use BrowserPool vs ReaderClient

| Use Case | Recommended |
|----------|-------------|
| Simple scraping/crawling | `ReaderClient` |
| Scripts and CLI tools | `ReaderClient` |
| Custom browser control | `BrowserPool` |
| Express/production servers | `BrowserPool` or Shared Hero Core |
| Low-level page interaction | `BrowserPool` |

For most use cases, **ReaderClient is recommended** as it manages the HeroCore lifecycle automatically. Use `BrowserPool` when you need direct access to Hero browser instances for custom logic.

## Overview

Browser instances are expensive:
- ~2-3 seconds to start
- ~200-500MB memory each
- Can accumulate state over time

The `BrowserPool` class manages a pool of reusable browser instances, handling lifecycle, recycling, and health monitoring.

## Basic Usage

### Using ReaderClient (Recommended)

The simplest way to configure browser pool settings:

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient({
  browserPool: {
    size: 5,                   // Number of browser instances
    retireAfterPages: 50,      // Recycle after N pages
    retireAfterMinutes: 15,    // Recycle after N minutes
    maxQueueSize: 100,         // Max pending requests
  },
});

// All scrape/crawl operations use the configured pool
const result = await reader.scrape({
  urls: ["https://example.com", "https://example.org"],
  batchConcurrency: 3,
});

await reader.close();
```

### Using BrowserPool Directly (Advanced)

For custom browser control:

```typescript
import { BrowserPool } from "@vakra-dev/reader";

const pool = new BrowserPool({ size: 5 });
await pool.initialize();

// Use withBrowser for automatic acquire/release
const title = await pool.withBrowser(async (hero) => {
  await hero.goto("https://example.com");
  return await hero.document.title;
});

await pool.shutdown();
```

## Configuration

```typescript
const pool = new BrowserPool({
  size: 5,                    // Number of browser instances
  retireAfterPages: 100,      // Recycle after N pages
  retireAfterMinutes: 30,     // Recycle after N minutes
  maxQueueSize: 100,          // Max pending requests
  healthCheckIntervalMs: 300000, // Health check interval (5 min)
});
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `size` | `2` | Number of browser instances in the pool |
| `retireAfterPages` | `100` | Recycle browser after this many pages |
| `retireAfterMinutes` | `30` | Recycle browser after this many minutes |
| `maxQueueSize` | `100` | Maximum requests that can wait for a browser |
| `healthCheckIntervalMs` | `300000` | Interval between health checks (5 minutes) |

## Pool Lifecycle

### Initialization

```typescript
const pool = new BrowserPool({ size: 5 });
await pool.initialize();
```

This:
1. Creates `size` Hero instances
2. Starts background health checking
3. Makes pool ready for requests

### Acquire and Release

**Recommended: Use `withBrowser`**

```typescript
const result = await pool.withBrowser(async (hero) => {
  await hero.goto("https://example.com");
  const title = await hero.document.title;
  return title;
});
```

Benefits:
- Automatic acquire/release
- Exception-safe (always releases on error)
- Clean, readable code

**Manual acquire/release (advanced)**

```typescript
const hero = await pool.acquire();
try {
  await hero.goto("https://example.com");
  // ... do work
} finally {
  await pool.release(hero);
}
```

### Recycling

Browsers are automatically recycled when:

1. **Page limit reached** - After `retireAfterPages` navigations
2. **Time limit reached** - After `retireAfterMinutes`
3. **Health check failure** - If browser becomes unresponsive

Recycling closes the old browser and creates a fresh one.

### Shutdown

```typescript
await pool.shutdown();
```

This:
1. Stops health checking
2. Closes all browser instances
3. Clears the queue

## Monitoring

### Get Pool Stats

```typescript
const stats = pool.getStats();
console.log(stats);
// {
//   total: 5,
//   available: 3,
//   inUse: 2,
//   queueSize: 0,
//   totalAcquired: 150,
//   totalRecycled: 3
// }
```

### Health Check

```typescript
const health = await pool.healthCheck();
console.log(health);
// {
//   healthy: true,
//   instances: [
//     { id: 0, healthy: true, pages: 45, ageMinutes: 12 },
//     { id: 1, healthy: true, pages: 38, ageMinutes: 10 },
//     ...
//   ]
// }
```

## Production Patterns

### Shared Pool for Express Server

```typescript
import express from "express";
import { BrowserPool } from "@vakra-dev/reader";

const app = express();
const pool = new BrowserPool({ size: 10 });

// Initialize on startup
pool.initialize().then(() => {
  console.log("Browser pool ready");
});

app.get("/scrape", async (req, res) => {
  const url = req.query.url as string;

  try {
    const result = await pool.withBrowser(async (hero) => {
      await hero.goto(url);
      return await hero.document.body.innerHTML;
    });

    res.json({ html: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  await pool.shutdown();
  process.exit(0);
});

app.listen(3000);
```

### Queue Management

When all browsers are busy, requests queue up:

```typescript
const pool = new BrowserPool({
  size: 5,
  maxQueueSize: 100,  // Max 100 waiting requests
});

// If queue is full, acquire() throws an error
try {
  const hero = await pool.acquire();
} catch (error) {
  if (error.message.includes("queue full")) {
    // Handle backpressure
    console.log("Too many pending requests");
  }
}
```

### Scaling Guidelines

| Concurrent Users | Pool Size | Memory (approx) |
|------------------|-----------|-----------------|
| 1-5 | 2-3 | 1-1.5 GB |
| 5-20 | 5-10 | 2.5-5 GB |
| 20-50 | 10-20 | 5-10 GB |
| 50+ | Consider distributed pools | 10+ GB |

## Shared Hero Core Pattern

For production servers, use a shared Hero Core instead of individual cores per browser:

```typescript
import HeroCore from "@ulixee/hero-core";
import { TransportBridge } from "@ulixee/net";
import { ConnectionToHeroCore } from "@ulixee/hero";

// Initialize once at startup
const heroCore = new HeroCore();
await heroCore.start();

// Create connection for each scrape
function createConnection() {
  const bridge = new TransportBridge();
  heroCore.addConnection(bridge.transportToClient);
  return new ConnectionToHeroCore(bridge.transportToCore);
}

// Use with scrape
const result = await scrape({
  urls: ["https://example.com"],
  connectionToCore: createConnection(),
});

// Shutdown on exit
await heroCore.close();
```

**Why use shared Core?**

- Single Chrome process manages all browsers
- Lower memory overhead
- Better resource utilization
- Faster browser creation

See [Production Server Guide](../deployment/production-server.md) for complete examples.

## Memory Management

### Reduce Memory Usage

```typescript
const pool = new BrowserPool({
  size: 3,                   // Fewer browsers
  retireAfterPages: 50,      // Recycle more often
  retireAfterMinutes: 15,    // Shorter lifetime
});
```

### Monitor Memory

```typescript
import { memoryUsage } from "process";

setInterval(() => {
  const usage = memoryUsage();
  console.log(`Memory: ${Math.round(usage.heapUsed / 1024 / 1024)} MB`);

  const stats = pool.getStats();
  console.log(`Pool: ${stats.inUse}/${stats.total} in use`);
}, 30000);
```

### Force Garbage Collection

Between large batch operations:

```typescript
const reader = new ReaderClient();

// Process batch
await reader.scrape({ urls: batch1 });

// Allow GC before next batch
await new Promise(r => setTimeout(r, 1000));

// Process next batch
await reader.scrape({ urls: batch2 });

await reader.close();
```

## Error Handling

### Browser Crashes

If a browser crashes, the pool automatically:
1. Removes it from the pool
2. Creates a replacement
3. Continues serving requests

### Timeout Handling

```typescript
const result = await pool.withBrowser(async (hero) => {
  // Set navigation timeout
  await hero.goto(url, { timeoutMs: 30000 });

  // ... rest of logic
}, { timeoutMs: 60000 }); // Overall operation timeout
```

### Retry Logic

```typescript
async function scrapeWithRetry(url: string, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await pool.withBrowser(async (hero) => {
        await hero.goto(url);
        return await hero.document.body.innerHTML;
      });
    } catch (error) {
      if (attempt === maxRetries) throw error;
      console.log(`Attempt ${attempt} failed, retrying...`);
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}
```

## Best Practices

1. **Always use `withBrowser`** - Ensures proper acquire/release
2. **Size pool appropriately** - Balance memory vs throughput
3. **Enable recycling** - Prevents memory leaks from long-running browsers
4. **Monitor stats** - Track pool utilization
5. **Handle shutdown gracefully** - Close pool on process exit
6. **Use shared Hero Core** - For production servers

## Related Guides

- [Production Server](../deployment/production-server.md) - Shared Hero Core setup
- [Cloudflare Bypass](cloudflare-bypass.md) - Challenge handling
- [Troubleshooting](../troubleshooting.md) - Common issues
