# Express Server Example

A production-ready Express server exposing Reader as a REST API.

## Features

- Health check endpoint
- Scrape endpoint (single and batch)
- Crawl endpoint
- Shared Hero Core for efficiency
- Graceful shutdown handling

## Setup

```bash
cd examples
npm install
```

## Usage

```bash
# Start the server
npx tsx production/express-server/src/index.ts
```

Server runs on http://localhost:3001

## API Endpoints

### GET /health

Health check endpoint.

```bash
curl http://localhost:3001/health
```

### POST /scrape

Scrape one or more URLs.

```bash
curl -X POST http://localhost:3001/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://example.com"],
    "formats": ["markdown", "text"]
  }'
```

**Request body:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| urls | string[] | required | URLs to scrape |
| formats | string[] | ["markdown"] | Output formats |
| batchConcurrency | number | 1 | Parallel requests |
| verbose | boolean | false | Enable logging |

### POST /crawl

Crawl a website to discover pages.

```bash
curl -X POST http://localhost:3001/crawl \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "depth": 2,
    "maxPages": 20,
    "scrape": true
  }'
```

**Request body:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| url | string | required | Seed URL |
| depth | number | 1 | Max depth (0-5) |
| maxPages | number | 20 | Max pages (1-100) |
| scrape | boolean | false | Also scrape content |

## Why Shared Hero Core?

This server uses a shared Hero Core instance instead of letting each request create its own:

| Approach | Startup Time | Memory | Best For |
|----------|--------------|--------|----------|
| Per-request Core | ~5-10s | High (each request) | Scripts, CLI |
| Shared Core | Once at startup | Shared across requests | Servers |

The shared Core is initialized once when the server starts, and all incoming requests share it via `TransportBridge`. This approach:

- **Eliminates cold starts** - No browser startup delay per request
- **Reduces memory usage** - Single Core instance shared across all requests
- **Improves throughput** - Requests don't wait for Core initialization

See [src/index.ts](./src/index.ts) for the implementation.

## Docker

See the [Docker deployment example](../../deployment/docker) for containerized deployment.

## Production Considerations

1. **Rate Limiting**: Add rate limiting middleware
2. **Authentication**: Add API key authentication
3. **Caching**: Cache scrape results (Redis, etc.)
4. **Queue**: Use job queue for async processing
5. **Monitoring**: Add metrics and logging
