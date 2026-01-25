# Docker Deployment Guide

Deploy Reader in Docker containers.

## Quick Start

### Basic Dockerfile

```dockerfile
# Dockerfile
FROM node:22-slim

# Install Chrome dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set Chrome path for Hero
ENV CHROME_PATH=/usr/bin/chromium

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application
COPY . .

# Build if TypeScript
RUN npm run build 2>/dev/null || true

EXPOSE 3000

CMD ["node", "dist/server.js"]
```

### Build and Run

```bash
# Build image
docker build -t reader .

# Run container
docker run -p 3000:3000 reader
```

## Docker Compose

### Basic Setup

```yaml
# docker-compose.yml
version: "3.8"

services:
  reader:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 2G
```

### With Redis (for job queues)

```yaml
# docker-compose.yml
version: "3.8"

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      - redis
    restart: unless-stopped

  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    environment:
      - NODE_ENV=production
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      - redis
    deploy:
      replicas: 3
      resources:
        limits:
          memory: 2G
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    restart: unless-stopped

volumes:
  redis-data:
```

### Start Services

```bash
# Start all services
docker-compose up -d

# Scale workers
docker-compose up -d --scale worker=5

# View logs
docker-compose logs -f worker

# Stop services
docker-compose down
```

## Optimized Dockerfile

### Multi-stage Build

```dockerfile
# Dockerfile
# Build stage
FROM node:22-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:22-slim

# Install Chrome dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

# Copy only production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy built application
COPY --from=builder /app/dist ./dist

# Non-root user for security
RUN groupadd -r app && useradd -r -g app app
USER app

EXPOSE 3000

CMD ["node", "dist/server.js"]
```

## Configuration

### Environment Variables

```yaml
# docker-compose.yml
services:
  reader:
    environment:
      - NODE_ENV=production
      - PORT=3000
      - LOG_LEVEL=info
      - CHROME_PATH=/usr/bin/chromium
      - MAX_CONCURRENT_REQUESTS=10
      - REQUEST_TIMEOUT_MS=60000
```

### Resource Limits

```yaml
services:
  reader:
    deploy:
      resources:
        limits:
          cpus: "2"
          memory: 4G
        reservations:
          cpus: "1"
          memory: 2G
```

### Health Checks

```yaml
services:
  reader:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

## Chrome Configuration

### Sandbox Mode

Chrome requires special configuration in Docker:

```dockerfile
# Add to Dockerfile
ENV CHROME_FLAGS="--no-sandbox --disable-setuid-sandbox"
```

Or configure in Hero:

```typescript
// In your application
const pool = new BrowserPool({
  heroOptions: {
    noChromeSandbox: true,
  },
});
```

### Shared Memory

Chrome needs sufficient shared memory:

```yaml
services:
  reader:
    shm_size: "2gb"
```

Or mount tmpfs:

```yaml
services:
  reader:
    volumes:
      - /dev/shm:/dev/shm
```

## Production Considerations

### Logging

```yaml
services:
  reader:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### Networking

```yaml
services:
  reader:
    networks:
      - internal
      - external

networks:
  internal:
    internal: true
  external:
```

### Secrets

```yaml
services:
  reader:
    secrets:
      - proxy_credentials

secrets:
  proxy_credentials:
    file: ./secrets/proxy.txt
```

### Volumes for Data

```yaml
services:
  reader:
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
```

## Scaling

### Docker Swarm

```yaml
# docker-stack.yml
version: "3.8"

services:
  reader:
    image: reader:latest
    deploy:
      replicas: 5
      update_config:
        parallelism: 2
        delay: 10s
      restart_policy:
        condition: on-failure
    networks:
      - traefik

networks:
  traefik:
    external: true
```

Deploy:

```bash
docker stack deploy -c docker-stack.yml reader
```

### Kubernetes

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: reader
spec:
  replicas: 3
  selector:
    matchLabels:
      app: reader
  template:
    metadata:
      labels:
        app: reader
    spec:
      containers:
        - name: reader
          image: reader:latest
          ports:
            - containerPort: 3000
          resources:
            limits:
              memory: "2Gi"
              cpu: "1"
          env:
            - name: NODE_ENV
              value: "production"
---
apiVersion: v1
kind: Service
metadata:
  name: reader
spec:
  selector:
    app: reader
  ports:
    - port: 80
      targetPort: 3000
```

## Troubleshooting

### Chrome Won't Start

```bash
# Check Chrome installation
docker exec -it container_name chromium --version

# Test Chrome manually
docker exec -it container_name chromium --headless --no-sandbox --dump-dom https://example.com
```

### Memory Issues

```yaml
# Increase limits
services:
  reader:
    deploy:
      resources:
        limits:
          memory: 4G
    shm_size: "2gb"
```

### Network Issues

```bash
# Debug networking
docker exec -it container_name curl https://example.com

# Check DNS
docker exec -it container_name nslookup example.com
```

## Complete Example

See [examples/deployment/docker/](../../examples/deployment/docker/) for a complete Docker setup.

## Related Guides

- [Production Server](production-server.md) - Server setup
- [Job Queues](job-queues.md) - Async processing
- [Serverless](serverless.md) - Lambda/Vercel deployment
