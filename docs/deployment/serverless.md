# Serverless Deployment Guide

Deploy Reader to serverless platforms.

## Overview

Serverless deployment requires special consideration because:
- Chrome can't run in standard serverless environments
- Cold starts are slow for browser automation
- Memory and timeout limits apply

**Solution:** Use remote browser services or container-based serverless.

> **Note:** For serverless environments, use the direct `scrape()` function with `connectionToCore` instead of `ReaderClient`, since you're connecting to a remote browser service rather than managing a local HeroCore instance.

## Remote Browser Services

Connect to a hosted Chrome instance instead of running locally.

### Browserless

```typescript
import { scrape } from "@vakra-dev/reader";

const result = await scrape({
  urls: ["https://example.com"],
  connectionToCore: "wss://chrome.browserless.io?token=YOUR_TOKEN",
});
```

### Other Providers

- [Browserless](https://browserless.io) - Popular, good Hero support
- [Bright Data](https://brightdata.com/products/scraping-browser) - Built-in proxy rotation
- [Apify](https://apify.com) - Browser automation platform

## AWS Lambda

### Container-based Lambda

Lambda supports containers, which can include Chrome.

#### Dockerfile

```dockerfile
FROM public.ecr.aws/lambda/nodejs:20

# Install Chrome dependencies
RUN yum install -y \
    chromium \
    nss \
    freetype \
    freetype-devel \
    fontconfig \
    pango \
    --skip-broken

ENV CHROME_PATH=/usr/bin/chromium-browser
ENV FONTCONFIG_PATH=/etc/fonts

COPY package*.json ./
RUN npm ci --only=production

COPY . .

CMD ["dist/handler.handler"]
```

#### Handler

```typescript
// handler.ts
import { scrape } from "@vakra-dev/reader";
import { APIGatewayProxyHandler } from "aws-lambda";

export const handler: APIGatewayProxyHandler = async (event) => {
  const body = JSON.parse(event.body || "{}");

  try {
    const result = await scrape({
      urls: body.urls,
      formats: body.formats || ["markdown"],
      showChrome: false,
    });

    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (error: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
```

#### Deploy

```bash
# Build and push to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com

docker build -t reader-lambda .
docker tag reader-lambda:latest YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/reader-lambda:latest
docker push YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/reader-lambda:latest

# Create Lambda function
aws lambda create-function \
  --function-name reader \
  --package-type Image \
  --code ImageUri=YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/reader-lambda:latest \
  --role arn:aws:iam::YOUR_ACCOUNT:role/lambda-execution-role \
  --memory-size 2048 \
  --timeout 60
```

### Lambda with Remote Browser

Use Browserless or similar with standard Lambda:

```typescript
// handler.ts
import { scrape } from "@vakra-dev/reader";

export const handler = async (event: any) => {
  const body = JSON.parse(event.body || "{}");

  const result = await scrape({
    urls: body.urls,
    formats: body.formats || ["markdown"],
    connectionToCore: process.env.BROWSERLESS_URL,
  });

  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
};
```

## Vercel Functions

### With Remote Browser

```typescript
// api/scrape.ts
import { scrape } from "@vakra-dev/reader";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { urls, formats = ["markdown"] } = req.body;

  try {
    const result = await scrape({
      urls,
      formats,
      connectionToCore: process.env.BROWSERLESS_URL,
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

export const config = {
  maxDuration: 60,
};
```

### vercel.json

```json
{
  "functions": {
    "api/scrape.ts": {
      "memory": 1024,
      "maxDuration": 60
    }
  }
}
```

### Environment Variables

```bash
vercel env add BROWSERLESS_URL
```

## Cloudflare Workers

Workers don't support Node.js natively, but you can:

### Use Remote Browser

```typescript
// src/index.ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const { urls } = await request.json();

    // Call external scraping service
    const response = await fetch(env.SCRAPER_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });

    return response;
  },
};
```

### Use Browser Rendering API

Cloudflare offers Browser Rendering API in beta:

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();

    await page.goto("https://example.com");
    const html = await page.content();

    await browser.close();

    return new Response(html);
  },
};
```

## Google Cloud Functions

### With Container

```yaml
# cloudbuild.yaml
steps:
  - name: "gcr.io/cloud-builders/docker"
    args: ["build", "-t", "gcr.io/$PROJECT_ID/reader", "."]
  - name: "gcr.io/cloud-builders/docker"
    args: ["push", "gcr.io/$PROJECT_ID/reader"]
  - name: "gcr.io/cloud-builders/gcloud"
    args:
      - "run"
      - "deploy"
      - "reader"
      - "--image"
      - "gcr.io/$PROJECT_ID/reader"
      - "--region"
      - "us-central1"
      - "--memory"
      - "2Gi"
      - "--timeout"
      - "60"
```

### With Remote Browser

```typescript
import * as functions from "@google-cloud/functions-framework";
import { scrape } from "@vakra-dev/reader";

functions.http("scrape", async (req, res) => {
  const { urls, formats } = req.body;

  try {
    const result = await scrape({
      urls,
      formats,
      connectionToCore: process.env.BROWSERLESS_URL,
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

## Configuration

### Memory & Timeout

| Platform | Max Memory | Max Timeout |
|----------|------------|-------------|
| AWS Lambda | 10 GB | 15 min |
| Vercel | 3 GB | 60 sec (Pro: 300s) |
| Google Cloud Functions | 16 GB | 60 min |
| Cloudflare Workers | 128 MB | 30 sec (unbounded) |

### Recommended Settings

```typescript
// Optimize for serverless
const result = await scrape({
  urls: [url],  // Process one at a time
  formats: ["markdown"],  // Single format
  timeoutMs: 30000,
  connectionToCore: process.env.BROWSERLESS_URL,
});
```

## Cost Optimization

### Minimize Invocations

```typescript
// Batch URLs when possible
const result = await scrape({
  urls: ["url1", "url2", "url3"],  // Multiple URLs per invocation
  batchConcurrency: 3,
});
```

### Use Caching

```typescript
import { createClient } from "@vercel/kv";

const kv = createClient({ /* config */ });

async function cachedScrape(url: string) {
  // Check cache
  const cached = await kv.get(`scrape:${url}`);
  if (cached) return cached;

  // Scrape
  const result = await scrape({ urls: [url] });

  // Cache for 1 hour
  await kv.set(`scrape:${url}`, result, { ex: 3600 });

  return result;
}
```

### Reduce Cold Starts

```typescript
// Keep connection warm
let connectionPromise: Promise<any>;

function getConnection() {
  if (!connectionPromise) {
    connectionPromise = initializeConnection();
  }
  return connectionPromise;
}
```

## Troubleshooting

### Timeout Issues

- Reduce URL count per request
- Use remote browser service
- Increase function timeout

### Memory Issues

- Increase memory allocation
- Process fewer URLs
- Use streaming responses

### Cold Start Issues

- Use provisioned concurrency (AWS)
- Keep functions warm with scheduled pings
- Use remote browser (faster connection)

## Related Guides

- [Production Server](production-server.md) - Traditional server setup
- [Docker](docker.md) - Container deployment
- [Troubleshooting](../troubleshooting.md) - Common issues
