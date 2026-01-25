# Job Queue with BullMQ

Async job processing for Reader using BullMQ and Redis.

## Overview

This example demonstrates how to run scrape operations asynchronously using a job queue. This is ideal for:

- **Batch processing**: Submit hundreds of URLs and process them in the background
- **Webhook notifications**: Get notified when jobs complete
- **Horizontal scaling**: Run multiple workers to increase throughput
- **Retry logic**: Automatically retry failed jobs with exponential backoff
- **Progress tracking**: Monitor job progress in real-time

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│  API Server │────▶│    Redis    │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          │                          │
              ┌─────▼─────┐            ┌───────▼───────┐           ┌──────▼──────┐
              │  Worker 1 │            │   Worker 2    │           │  Worker N   │
              └───────────┘            └───────────────┘           └─────────────┘
```

## Prerequisites

- Redis server running (local or remote)
- Node.js >= 18

## Setup

1. Install dependencies:
   ```bash
   cd examples/production/job-queue-bullmq
   npm install
   ```

2. Start Redis (if not running):
   ```bash
   # Using Docker
   docker run -d -p 6379:6379 redis:alpine

   # Or using Homebrew (macOS)
   brew services start redis
   ```

3. Start the API server:
   ```bash
   npm run start
   ```

4. Start the worker (in a separate terminal):
   ```bash
   npm run worker
   ```

5. Or run both together:
   ```bash
   npm run dev
   ```

## API Endpoints

### Submit a Job

```bash
curl -X POST http://localhost:3002/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://example.com", "https://httpbin.org/html"],
    "formats": ["markdown"],
    "webhookUrl": "https://your-server.com/webhook"
  }'
```

Response:
```json
{
  "jobId": "1",
  "status": "queued",
  "urls": 2
}
```

### Check Job Status

```bash
curl http://localhost:3002/jobs/1
```

Response:
```json
{
  "id": "1",
  "state": "completed",
  "progress": 100,
  "data": {
    "urls": ["https://example.com"],
    "formats": ["markdown"]
  },
  "result": {
    "success": true,
    "data": {
      "batchMetadata": {
        "totalUrls": 1,
        "successfulUrls": 1,
        "failedUrls": 0,
        "totalDurationMs": 2500
      },
      "results": [...]
    }
  },
  "timestamps": {
    "created": 1704067200000,
    "processed": 1704067201000,
    "finished": 1704067203500
  },
  "attempts": 1
}
```

### Queue Statistics

```bash
curl http://localhost:3002/stats
```

Response:
```json
{
  "waiting": 5,
  "active": 2,
  "completed": 150,
  "failed": 3,
  "delayed": 0
}
```

### Retry a Failed Job

```bash
curl -X POST http://localhost:3002/jobs/1/retry
```

### Remove a Job

```bash
curl -X DELETE http://localhost:3002/jobs/1
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3002 | API server port |
| `REDIS_URL` | redis://localhost:6379 | Redis connection URL |
| `WORKER_CONCURRENCY` | 2 | Jobs processed simultaneously |

### Job Options

When submitting a job, you can configure:

```json
{
  "urls": ["..."],
  "formats": ["markdown", "html"],
  "webhookUrl": "https://...",
  "priority": 1,
  "delay": 5000
}
```

- **priority**: Lower number = higher priority (default: undefined)
- **delay**: Milliseconds to wait before processing (default: 0)

## Webhook Notifications

When a `webhookUrl` is provided, the worker sends notifications:

### Job Completed
```json
{
  "event": "job.completed",
  "jobId": "1",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "result": {
    "success": true,
    "batchMetadata": {...},
    "urlCount": 2
  }
}
```

### Job Failed
```json
{
  "event": "job.failed",
  "jobId": "1",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "error": "Timeout waiting for page"
}
```

## Scaling Workers

Run multiple workers to increase throughput:

```bash
# Terminal 1
WORKER_CONCURRENCY=4 npm run worker

# Terminal 2
WORKER_CONCURRENCY=4 npm run worker

# Terminal 3
WORKER_CONCURRENCY=4 npm run worker
```

Each worker processes jobs independently. BullMQ ensures no job is processed twice.

## Production Considerations

1. **Redis Persistence**: Configure Redis with AOF or RDB persistence for durability
2. **Memory Limits**: Set Redis maxmemory to prevent OOM
3. **Worker Health**: Use process managers like PM2 to restart crashed workers
4. **Monitoring**: Use BullMQ's built-in dashboard or integrate with observability tools
5. **Rate Limiting**: The worker is configured to process max 10 jobs/second

## Files

```
job-queue-bullmq/
├── README.md           # This file
├── package.json        # Dependencies
└── src/
    ├── index.ts        # API server
    ├── queue.ts        # Queue configuration
    └── worker.ts       # Job processor
```
