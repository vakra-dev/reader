# Docker Deployment

Run Reader as a REST API server in a Docker container.

## Platform Requirements

**Supported:**
- x86_64 Linux servers (native)
- x86_64 cloud VMs (AWS EC2, GCP, Azure, DigitalOcean)

**Not Supported:**
- Apple Silicon Macs (M1/M2/M3) - Hero bundles x86_64 Chromium which doesn't run stably under Rosetta 2/QEMU emulation

### Apple Silicon Workarounds

If you're developing on an Apple Silicon Mac:

1. **Run locally without Docker** (recommended for development):
   ```bash
   cd examples/production/express-server
   npx tsx src/index.ts
   ```

2. **Deploy to a cloud VM** for Docker testing:
   - Use an x86_64 Linux VM (AWS t3.medium, DigitalOcean droplet, etc.)
   - Docker runs natively without emulation issues

3. **Use a remote browser service**:
   ```typescript
   const result = await scrape({
     urls: ["https://example.com"],
     connectionToCore: "wss://chrome.browserless.io?token=YOUR_TOKEN",
   });
   ```

## Quick Start

From the `reader` package directory:

```bash
cd examples/deployment/docker
docker-compose up -d
```

The server will be available at http://localhost:3001

## API Endpoints

```bash
# Health check
curl http://localhost:3001/health

# Scrape a URL
curl -X POST http://localhost:3001/scrape \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://example.com"], "formats": ["markdown"]}'

# Crawl a website
curl -X POST http://localhost:3001/crawl \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "depth": 1, "maxPages": 10}'
```

## Manual Build

From the `reader` package directory:

```bash
# Build image
docker build -t reader -f examples/deployment/docker/Dockerfile .

# Run container
docker run -d \
  --name reader \
  -p 3001:3001 \
  --shm-size=2gb \
  --security-opt seccomp=unconfined \
  --cap-add SYS_ADMIN \
  reader
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3001 | Server port |
| NODE_ENV | production | Node environment |
| PROXY_URL | - | Optional proxy URL |

### Resource Requirements

- **Memory**: Minimum 2GB RAM (4GB recommended)
- **Shared Memory**: 2GB (`--shm-size=2gb`) required for Chrome
- **CPU**: 1+ cores (2+ recommended for concurrent scraping)

## Logs

```bash
# View logs
docker-compose logs -f

# Check health status
docker inspect --format='{{.State.Health.Status}}' reader
```

## Stop

```bash
docker-compose down
```

## Troubleshooting

### Chrome Crashes

Increase shared memory:

```bash
docker run --shm-size=4gb ...
```

### Network Issues

Use host network mode for debugging:

```bash
docker run --network=host ...
```

### Architecture Issues (Apple Silicon)

If you see errors like:
- `qemu-x86_64: Could not open '/lib64/ld-linux-x86-64.so.2'`
- `Page has been closed` during scrape operations
- Chrome crashes or ECONNRESET errors

This is due to x86_64 emulation instability on ARM64 Macs. See "Platform Requirements" above for workarounds.
