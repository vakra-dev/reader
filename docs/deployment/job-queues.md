# Job Queues Guide

Use job queues for async scraping at scale with BullMQ.

## Overview

For high-volume scraping, use a job queue to:
- Process requests asynchronously
- Handle retries automatically
- Scale workers independently
- Monitor job progress
- Avoid overwhelming target sites

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   API       │────▶│   Redis     │────▶│   Workers   │
│   Server    │     │   Queue     │     │   (N)       │
└─────────────┘     └─────────────┘     └─────────────┘
       │                                       │
       │         ┌─────────────┐              │
       └────────▶│   Results   │◀─────────────┘
                 │   Store     │
                 └─────────────┘
```

## Setup

### Installation

```bash
npm install bullmq ioredis @vakra-dev/reader
```

### Basic Queue Setup

```typescript
// queue.ts
import { Queue, Worker, Job } from "bullmq";
import { scrape } from "@vakra-dev/reader";

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
};

// Create queue
export const scrapeQueue = new Queue("scrape", { connection });

// Job data interface
interface ScrapeJobData {
  urls: string[];
  formats: ("markdown" | "html" | "json" | "text")[];
  callbackUrl?: string;
}

// Add job to queue
export async function enqueueScrape(data: ScrapeJobData) {
  const job = await scrapeQueue.add("scrape", data, {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
  });

  return job.id;
}
```

### Worker Process

```typescript
// worker.ts
import { Worker, Job } from "bullmq";
import HeroCore from "@ulixee/hero-core";
import { TransportBridge } from "@ulixee/net";
import { ConnectionToHeroCore } from "@ulixee/hero";
import { scrape } from "@vakra-dev/reader";

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
};

// Shared Hero Core
let heroCore: HeroCore;

async function createConnection() {
  const bridge = new TransportBridge();
  heroCore.addConnection(bridge.transportToClient);
  return new ConnectionToHeroCore(bridge.transportToCore);
}

// Process jobs
const worker = new Worker(
  "scrape",
  async (job: Job) => {
    const { urls, formats } = job.data;

    console.log(`Processing job ${job.id}: ${urls.length} URLs`);

    const result = await scrape({
      urls,
      formats,
      connectionToCore: await createConnection(),
      onProgress: async ({ completed, total }) => {
        await job.updateProgress((completed / total) * 100);
      },
    });

    // Callback if provided
    if (job.data.callbackUrl) {
      await fetch(job.data.callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
    }

    return result;
  },
  {
    connection,
    concurrency: 5,
  }
);

// Event handlers
worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

// Start worker
async function start() {
  heroCore = new HeroCore();
  await heroCore.start();
  console.log("Worker started, waiting for jobs...");
}

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down worker...");
  await worker.close();
  if (heroCore) await heroCore.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start().catch(console.error);
```

### API Server

```typescript
// api.ts
import express from "express";
import { scrapeQueue, enqueueScrape } from "./queue";

const app = express();
app.use(express.json());

// Enqueue scrape job
app.post("/scrape", async (req, res) => {
  const { urls, formats, callbackUrl } = req.body;

  const jobId = await enqueueScrape({ urls, formats, callbackUrl });

  res.json({ jobId, status: "queued" });
});

// Get job status
app.get("/job/:id", async (req, res) => {
  const job = await scrapeQueue.getJob(req.params.id);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  const state = await job.getState();
  const progress = job.progress;

  res.json({
    id: job.id,
    state,
    progress,
    data: job.data,
    result: job.returnvalue,
    failedReason: job.failedReason,
  });
});

// Get job result
app.get("/job/:id/result", async (req, res) => {
  const job = await scrapeQueue.getJob(req.params.id);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  const state = await job.getState();

  if (state !== "completed") {
    return res.status(202).json({ status: state, progress: job.progress });
  }

  res.json(job.returnvalue);
});

app.listen(3000, () => {
  console.log("API server running on port 3000");
});
```

## Job Options

### Retry Configuration

```typescript
await scrapeQueue.add("scrape", data, {
  attempts: 5,
  backoff: {
    type: "exponential",
    delay: 5000,  // 5s, 10s, 20s, 40s, 80s
  },
});
```

### Priority

```typescript
// High priority (lower number = higher priority)
await scrapeQueue.add("scrape", urgentData, { priority: 1 });

// Normal priority
await scrapeQueue.add("scrape", normalData, { priority: 5 });

// Low priority
await scrapeQueue.add("scrape", bulkData, { priority: 10 });
```

### Delayed Jobs

```typescript
// Process after 5 minutes
await scrapeQueue.add("scrape", data, {
  delay: 5 * 60 * 1000,
});
```

### Rate Limiting

```typescript
// Max 10 jobs per minute
const worker = new Worker("scrape", processor, {
  limiter: {
    max: 10,
    duration: 60000,
  },
});
```

## Scaling Workers

### Multiple Workers

Run multiple worker processes:

```bash
# Terminal 1
WORKER_ID=1 npx tsx worker.ts

# Terminal 2
WORKER_ID=2 npx tsx worker.ts

# Terminal 3
WORKER_ID=3 npx tsx worker.ts
```

### Worker Concurrency

```typescript
const worker = new Worker("scrape", processor, {
  connection,
  concurrency: 5,  // Process 5 jobs simultaneously
});
```

### Auto-Scaling

```typescript
// Scale based on queue depth
async function checkScale() {
  const waiting = await scrapeQueue.getWaitingCount();
  const active = await scrapeQueue.getActiveCount();

  console.log(`Queue: ${waiting} waiting, ${active} active`);

  if (waiting > 100) {
    // Signal to scale up
    await notifyScaleUp();
  }
}

setInterval(checkScale, 30000);
```

## Monitoring

### Queue Dashboard (Bull Board)

```typescript
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: [new BullMQAdapter(scrapeQueue)],
  serverAdapter,
});

app.use("/admin/queues", serverAdapter.getRouter());
```

### Metrics

```typescript
// Queue stats
async function getQueueStats() {
  return {
    waiting: await scrapeQueue.getWaitingCount(),
    active: await scrapeQueue.getActiveCount(),
    completed: await scrapeQueue.getCompletedCount(),
    failed: await scrapeQueue.getFailedCount(),
    delayed: await scrapeQueue.getDelayedCount(),
  };
}

app.get("/stats", async (req, res) => {
  res.json(await getQueueStats());
});
```

### Events

```typescript
// Listen to queue events
scrapeQueue.on("completed", (job) => {
  metrics.increment("jobs.completed");
  metrics.timing("jobs.duration", job.processedOn - job.timestamp);
});

scrapeQueue.on("failed", (job, err) => {
  metrics.increment("jobs.failed");
  alerting.notify(`Job ${job.id} failed: ${err.message}`);
});
```

## Error Handling

### Retry Strategy

```typescript
const worker = new Worker(
  "scrape",
  async (job) => {
    try {
      return await scrape(job.data);
    } catch (error) {
      // Don't retry on certain errors
      if (error.message.includes("Invalid URL")) {
        throw new Error(`Permanent failure: ${error.message}`);
      }
      // Retry on transient errors
      throw error;
    }
  },
  {
    connection,
    settings: {
      backoffStrategy: (attemptsMade) => {
        // Custom backoff: 5s, 30s, 2m, 10m
        const delays = [5000, 30000, 120000, 600000];
        return delays[Math.min(attemptsMade - 1, delays.length - 1)];
      },
    },
  }
);
```

### Dead Letter Queue

```typescript
// Move failed jobs to DLQ after all retries
await scrapeQueue.add("scrape", data, {
  attempts: 3,
  removeOnFail: {
    age: 24 * 3600,  // Keep for 24 hours
  },
});

// Process DLQ manually
const failedJobs = await scrapeQueue.getFailed();
for (const job of failedJobs) {
  console.log(`Failed job ${job.id}: ${job.failedReason}`);
  // Optionally retry
  await job.retry();
}
```

## Complete Example

```typescript
// complete-example.ts
import { Queue, Worker, Job } from "bullmq";
import express from "express";
import HeroCore from "@ulixee/hero-core";
import { scrape, ScrapeResult } from "@vakra-dev/reader";

const app = express();
app.use(express.json());

// Redis connection
const connection = { host: "localhost", port: 6379 };

// Queue
const scrapeQueue = new Queue("scrape", { connection });

// Shared Hero Core
let heroCore: HeroCore;

// Worker
const worker = new Worker<any, ScrapeResult>(
  "scrape",
  async (job: Job) => {
    const result = await scrape({
      ...job.data,
      connectionToCore: await createConnection(),
    });
    return result;
  },
  { connection, concurrency: 3 }
);

// API endpoints
app.post("/scrape/async", async (req, res) => {
  const job = await scrapeQueue.add("scrape", req.body);
  res.json({ jobId: job.id });
});

app.get("/scrape/:jobId", async (req, res) => {
  const job = await scrapeQueue.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Not found" });

  const state = await job.getState();
  res.json({
    state,
    progress: job.progress,
    result: state === "completed" ? job.returnvalue : null,
  });
});

// Start
async function start() {
  heroCore = new HeroCore();
  await heroCore.start();

  app.listen(3000, () => console.log("Server running"));
}

start();
```

## Related Guides

- [Production Server](production-server.md) - Basic server setup
- [Docker](docker.md) - Containerized deployment
- [Browser Pool](../guides/browser-pool.md) - Managing browsers
