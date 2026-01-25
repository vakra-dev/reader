# Browser Pool Scaling

Advanced browser pool configuration with metrics, health monitoring, and scaling.

## Overview

This example demonstrates production-grade browser pool management:

- **Pool metrics**: Monitor browser utilization, queue depth, and request latency
- **Health checks**: Detect and recover from unhealthy browsers
- **Auto-recycling**: Prevent memory leaks by retiring browsers after use
- **Prometheus integration**: Export metrics for monitoring dashboards
- **Graceful degradation**: Handle overload without crashing

## Setup

1. Install dependencies:
   ```bash
   cd examples/production/browser-pool-scaling
   npm install
   ```

2. Start the server:
   ```bash
   npm run start
   ```

## API Endpoints

### Health Check

```bash
curl http://localhost:3003/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 3600000,
  "uptimeFormatted": "1h 0m",
  "pool": {
    "healthy": true,
    "issues": []
  }
}
```

### Metrics (JSON)

```bash
curl http://localhost:3003/metrics
```

Response:
```json
{
  "pool": {
    "total": 4,
    "available": 2,
    "busy": 2,
    "recycling": 0,
    "unhealthy": 0,
    "queueLength": 0
  },
  "performance": {
    "totalRequests": 150,
    "avgRequestDurationMs": 2500
  },
  "utilization": {
    "percentage": 50,
    "status": "moderate"
  },
  "config": {
    "poolSize": 4,
    "retireAfterPageCount": 50,
    "retireAfterAgeMs": 900000,
    "maxQueueSize": 200,
    "queueTimeout": 120000
  }
}
```

### Metrics (Prometheus)

```bash
curl "http://localhost:3003/metrics?format=prometheus"
```

Response:
```
# HELP reader_pool_total Total browser instances in pool
# TYPE reader_pool_total gauge
reader_pool_total 4

# HELP reader_pool_available Available browser instances
# TYPE reader_pool_available gauge
reader_pool_available 2

# HELP reader_pool_busy Busy browser instances
# TYPE reader_pool_busy gauge
reader_pool_busy 2
...
```

### Scrape URL

```bash
curl -X POST http://localhost:3003/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

Response:
```json
{
  "success": true,
  "url": "https://example.com",
  "title": "Example Domain",
  "htmlLength": 1256,
  "durationMs": 1523
}
```

### Batch Scrape

```bash
curl -X POST http://localhost:3003/batch \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://example.com", "https://httpbin.org/html"],
    "concurrency": 2
  }'
```

Response:
```json
{
  "success": true,
  "summary": {
    "total": 2,
    "successful": 2,
    "failed": 0,
    "durationMs": 3200,
    "avgPerUrl": 1600
  },
  "results": [...]
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3003 | Server port |
| `POOL_SIZE` | 4 | Number of browser instances |
| `RETIRE_AFTER_PAGES` | 50 | Recycle browser after N pages |
| `RETIRE_AFTER_MS` | 900000 | Recycle browser after 15 minutes |
| `MAX_QUEUE_SIZE` | 200 | Maximum pending requests |
| `QUEUE_TIMEOUT` | 120000 | Request timeout in queue (2 min) |

### Scaling Recommendations

| Use Case | Pool Size | Notes |
|----------|-----------|-------|
| Development | 2 | Low memory usage |
| Small API | 4-8 | Handles ~10 req/min |
| Medium traffic | 8-16 | Handles ~50 req/min |
| High traffic | 16-32+ | Use multiple instances |

### Memory Considerations

Each browser instance uses approximately 100-300MB RAM. Plan accordingly:

| Pool Size | Memory (approx) |
|-----------|-----------------|
| 2 | 400-600 MB |
| 4 | 800 MB - 1.2 GB |
| 8 | 1.6 - 2.4 GB |
| 16 | 3.2 - 4.8 GB |

## Prometheus & Grafana

### Prometheus Configuration

Add to `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'reader'
    scrape_interval: 15s
    metrics_path: /metrics
    params:
      format: ['prometheus']
    static_configs:
      - targets: ['localhost:3003']
```

### Grafana Dashboard

Key metrics to monitor:

1. **Pool Utilization**: `reader_pool_busy / reader_pool_total`
2. **Queue Depth**: `reader_pool_queue_length`
3. **Unhealthy Instances**: `reader_pool_unhealthy`
4. **Request Latency**: `reader_pool_request_duration_avg_ms`

### Alerting Rules

```yaml
groups:
  - name: reader
    rules:
      - alert: HighPoolUtilization
        expr: reader_pool_busy / reader_pool_total > 0.9
        for: 5m
        annotations:
          summary: "Browser pool near capacity"

      - alert: UnhealthyBrowsers
        expr: reader_pool_unhealthy > 0
        for: 2m
        annotations:
          summary: "Unhealthy browser instances detected"

      - alert: HighQueueDepth
        expr: reader_pool_queue_length > 50
        for: 1m
        annotations:
          summary: "Request queue growing"
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser Pool                            │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Browser  │  │ Browser  │  │ Browser  │  │ Browser  │    │
│  │   #1     │  │   #2     │  │   #3     │  │   #4     │    │
│  │  (busy)  │  │ (avail)  │  │  (busy)  │  │ (avail)  │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
├─────────────────────────────────────────────────────────────┤
│  Request Queue: [req5] [req6] [req7] ...                    │
├─────────────────────────────────────────────────────────────┤
│  Recycler: Checks every 60s, retires old/heavy browsers     │
│  Health Check: Every 5min, marks unhealthy browsers         │
└─────────────────────────────────────────────────────────────┘
```

## Files

```
browser-pool-scaling/
├── README.md           # This file
├── package.json        # Dependencies
└── src/
    └── index.ts        # Server with pool management
```
