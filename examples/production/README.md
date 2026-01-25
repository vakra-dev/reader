# Production Examples

Production-ready setups for running Reader at scale.

## Available Examples

### [Express Server](./express-server/)

A full-featured REST API server with:
- Health checks and graceful shutdown
- Scrape and crawl endpoints
- Shared Hero Core for efficiency
- Request validation and error handling

### [Job Queue (BullMQ)](./job-queue-bullmq/)

Async job processing with Redis:
- Submit jobs via API, process in background
- Progress tracking and webhook notifications
- Automatic retries with exponential backoff
- Horizontally scalable workers

### [Browser Pool Scaling](./browser-pool-scaling/)

Advanced browser pool management:
- Pool metrics (JSON and Prometheus formats)
- Health checks with auto-recovery
- Browser recycling to prevent memory leaks
- Graceful degradation under load

## Best Practices

1. **Use a Shared Core**: Initialize Hero Core once and share across requests
2. **Implement Health Checks**: Monitor browser pool health
3. **Add Rate Limiting**: Protect against abuse
4. **Use Caching**: Cache scrape results (Redis, Memcached)
5. **Queue Long Operations**: Use job queues for batch scraping
6. **Monitor Resources**: Track memory, CPU, and pool metrics

## Quick Comparison

| Example | Use Case | Dependencies |
|---------|----------|--------------|
| Express Server | Simple REST API | Express |
| Job Queue | Async batch processing | BullMQ, Redis |
| Pool Scaling | High-throughput scraping | Express |

## Getting Started

Each example has its own README with setup instructions:

```bash
# Express Server
cd express-server && npm install && npm start

# Job Queue
cd job-queue-bullmq && npm install
npm run start   # API server
npm run worker  # Worker process

# Pool Scaling
cd browser-pool-scaling && npm install && npm start
```
