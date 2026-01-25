# Vercel Functions Deployment

Deploy Reader as Vercel Serverless Functions.

## Important Notes

Running a full browser in Vercel Functions is not recommended due to:
- Cold start times
- Memory limits
- Binary size restrictions
- Execution time limits (10-30 seconds)

**Recommended approach**: Use a remote browser service.

## Setup with Remote Browser

1. Sign up for a browser service:
   - [Browserless](https://browserless.io)
   - [Browserbase](https://browserbase.com)
   - Or self-hosted

2. Set environment variable:
   ```bash
   vercel env add BROWSER_WS_ENDPOINT
   # Enter: wss://chrome.browserless.io?token=YOUR_TOKEN
   ```

3. Deploy:
   ```bash
   vercel deploy
   ```

## Project Structure

```
vercel-functions/
├── api/
│   └── scrape.ts    # /api/scrape endpoint
├── package.json
└── vercel.json
```

## Configuration

### vercel.json

```json
{
  "functions": {
    "api/scrape.ts": {
      "memory": 1024,
      "maxDuration": 30
    }
  }
}
```

### package.json

```json
{
  "dependencies": {
    "@vakra-dev/reader": "^1.0.0"
  }
}
```

## Usage

```bash
curl -X POST https://your-app.vercel.app/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://example.com"]}'
```

## Alternative: Edge Functions

For better performance, use Vercel Edge Functions with a fetch-based approach:

```typescript
// api/scrape-edge.ts
export const config = {
  runtime: "edge",
};

export default async function handler(req: Request) {
  // Use fetch to call Reader running elsewhere
  const response = await fetch("https://your-reader.com/scrape", {
    method: "POST",
    body: req.body,
  });
  return response;
}
```

This approach:
- Sub-second cold starts
- Global edge network
- Lower latency for users
