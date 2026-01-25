# Production Server Guide

Deploy Reader as a production-ready API server.

## Overview

For production servers, use a **shared Hero Core** pattern instead of spawning individual Chrome processes per request. This dramatically reduces resource usage and improves performance.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                Express Server                    │
├─────────────────────────────────────────────────┤
│              Shared Hero Core                    │
│         (Single Chrome Process)                  │
├─────────────────────────────────────────────────┤
│   Browser 1  │  Browser 2  │  Browser 3  │ ...  │
│   (Tab)      │  (Tab)      │  (Tab)      │      │
└─────────────────────────────────────────────────┘
```

**Benefits:**
- Single Chrome process instead of one per request
- Lower memory footprint
- Faster browser creation
- Better resource utilization

## Basic Setup

### Installation

```bash
npm install @vakra-dev/reader express
npm install @ulixee/hero-core @ulixee/net  # For shared Core
```

### Server Code

```typescript
// server.ts
import express from "express";
import HeroCore from "@ulixee/hero-core";
import { TransportBridge } from "@ulixee/net";
import { ConnectionToHeroCore } from "@ulixee/hero";
import { scrape, crawl } from "@vakra-dev/reader";

const app = express();
app.use(express.json());

// Shared Hero Core - initialized once
let heroCore: HeroCore;

async function createConnection() {
  const bridge = new TransportBridge();
  heroCore.addConnection(bridge.transportToClient);
  return new ConnectionToHeroCore(bridge.transportToCore);
}

// Scrape endpoint
app.post("/scrape", async (req, res) => {
  const { urls, formats = ["markdown"] } = req.body;

  try {
    const result = await scrape({
      urls,
      formats,
      connectionToCore: await createConnection(),
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Crawl endpoint
app.post("/crawl", async (req, res) => {
  const { url, depth = 2, maxPages = 20, scrape: doScrape = false } = req.body;

  try {
    const result = await crawl({
      url,
      depth,
      maxPages,
      scrape: doScrape,
      connectionToCore: await createConnection(),
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", heroCore: heroCore ? "running" : "stopped" });
});

// Start server
async function start() {
  // Initialize shared Hero Core
  heroCore = new HeroCore();
  await heroCore.start();
  console.log("Hero Core started");

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down...");
  if (heroCore) {
    await heroCore.close();
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start().catch(console.error);
```

### Run the Server

```bash
npx tsx server.ts
```

### Test Endpoints

```bash
# Scrape
curl -X POST http://localhost:3000/scrape \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://example.com"], "formats": ["markdown"]}'

# Crawl
curl -X POST http://localhost:3000/crawl \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "depth": 2, "scrape": true}'
```

## Production Configuration

### Environment Variables

```bash
# .env
PORT=3000
NODE_ENV=production
LOG_LEVEL=info
MAX_CONCURRENT_REQUESTS=10
REQUEST_TIMEOUT_MS=60000
```

### Request Limits

```typescript
import rateLimit from "express-rate-limit";

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 100,             // 100 requests per minute
});

app.use(limiter);

// Request timeout
app.use((req, res, next) => {
  res.setTimeout(60000, () => {
    res.status(408).json({ error: "Request timeout" });
  });
  next();
});
```

### Request Validation

```typescript
import { z } from "zod";

const scrapeSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(100),
  formats: z.array(z.enum(["markdown", "html", "json", "text"])).optional(),
  batchConcurrency: z.number().min(1).max(10).optional(),
});

app.post("/scrape", async (req, res) => {
  const parsed = scrapeSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues });
  }

  // ... handle request
});
```

## Concurrency Control

### Request Queue

```typescript
import PQueue from "p-queue";

const requestQueue = new PQueue({
  concurrency: parseInt(process.env.MAX_CONCURRENT_REQUESTS || "10"),
});

app.post("/scrape", async (req, res) => {
  try {
    const result = await requestQueue.add(() =>
      scrape({
        urls: req.body.urls,
        formats: req.body.formats,
        connectionToCore: await createConnection(),
      })
    );

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

### Timeout Handling

```typescript
async function scrapeWithTimeout(options: ScrapeOptions, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await scrape({
      ...options,
      connectionToCore: await createConnection(),
    });
  } finally {
    clearTimeout(timeout);
  }
}
```

## Monitoring

### Health Checks

```typescript
let activeRequests = 0;
let totalRequests = 0;
let failedRequests = 0;

app.use((req, res, next) => {
  activeRequests++;
  totalRequests++;

  res.on("finish", () => {
    activeRequests--;
    if (res.statusCode >= 500) failedRequests++;
  });

  next();
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    heroCore: heroCore ? "running" : "stopped",
    stats: {
      activeRequests,
      totalRequests,
      failedRequests,
      queueSize: requestQueue.size,
      queuePending: requestQueue.pending,
    },
  });
});
```

### Logging

```typescript
import pino from "pino";
import pinoHttp from "pino-http";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
});

app.use(pinoHttp({ logger }));

// Log scrape requests
app.post("/scrape", async (req, res) => {
  const startTime = Date.now();

  try {
    const result = await scrape({ ... });

    logger.info({
      type: "scrape",
      urls: req.body.urls.length,
      duration: Date.now() - startTime,
      successful: result.batchMetadata.successfulUrls,
    });

    res.json(result);
  } catch (error) {
    logger.error({ type: "scrape_error", error: error.message });
    res.status(500).json({ error: error.message });
  }
});
```

## Scaling

### Horizontal Scaling

Run multiple server instances behind a load balancer:

```bash
# Start multiple instances
PORT=3001 npx tsx server.ts &
PORT=3002 npx tsx server.ts &
PORT=3003 npx tsx server.ts &
```

### PM2 Cluster Mode

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: "reader",
    script: "server.ts",
    interpreter: "npx",
    interpreter_args: "tsx",
    instances: "max",
    exec_mode: "cluster",
    env: {
      NODE_ENV: "production",
      PORT: 3000,
    },
  }],
};
```

```bash
pm2 start ecosystem.config.js
```

### Memory Limits

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: "reader",
    script: "server.ts",
    max_memory_restart: "2G",
    node_args: "--max-old-space-size=2048",
  }],
};
```

## Complete Example

See [examples/production/express-server/](../../examples/production/express-server/) for a complete production server implementation.

## Related Guides

- [Docker Deployment](docker.md) - Containerized deployment
- [Job Queues](job-queues.md) - Async job processing
- [Browser Pool](../guides/browser-pool.md) - Pool management
