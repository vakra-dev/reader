# Reader Examples

Examples demonstrating various uses of Reader.

## Structure

```
examples/
├── basic/                    # Basic usage examples
│   ├── basic-scrape.ts       # Single URL scraping
│   ├── batch-scrape.ts       # Concurrent multi-URL scraping
│   ├── large-batch-scrape.ts # Large-scale batch scraping (1000+ URLs)
│   ├── browser-pool-config.ts # Browser pool configuration
│   ├── proxy-pool.ts         # Proxy rotation with multiple proxies
│   ├── cloudflare-bypass.ts  # Cloudflare-protected site scraping
│   ├── crawl-website.ts      # Website crawling
│   ├── all-formats.ts        # All output formats
│   └── with-proxy.ts         # Single proxy configuration
│
├── ai-tools/                 # AI framework integrations
│   ├── openai-summary.ts     # OpenAI summarization
│   ├── anthropic-summary.ts  # Anthropic summarization
│   ├── vercel-ai-stream.ts   # Vercel AI SDK streaming
│   ├── langchain-loader.ts   # LangChain document loader
│   ├── llamaindex-loader.ts  # LlamaIndex document loader
│   ├── pinecone-ingest.ts    # Pinecone vector store
│   └── qdrant-ingest.ts      # Qdrant vector store
│
├── production/               # Production-ready setups
│   └── express-server/       # REST API server
│
└── deployment/               # Cloud deployment guides
    ├── docker/               # Docker + docker-compose
    ├── aws-lambda/           # AWS Lambda (container)
    └── vercel-functions/     # Vercel serverless
```

## Quick Start

1. Install dependencies from the examples folder:

```bash
cd examples
npm install
```

2. Start Ulixee Cloud (in a separate terminal):

```bash
npx @ulixee/cloud start
```

3. Run any example using tsx:

```bash
# Basic examples
npx tsx basic/basic-scrape.ts
npx tsx basic/batch-scrape.ts
npx tsx basic/large-batch-scrape.ts  # Large-scale (1000+ URLs)
npx tsx basic/browser-pool-config.ts
npx tsx basic/proxy-pool.ts
npx tsx basic/cloudflare-bypass.ts
npx tsx basic/crawl-website.ts

# AI tools examples (requires API keys)
export OPENAI_API_KEY="sk-..."
npx tsx ai-tools/openai-summary.ts https://example.com

export ANTHROPIC_API_KEY="sk-..."
npx tsx ai-tools/anthropic-summary.ts https://example.com

# Production server
npx tsx production/express-server/src/index.ts
```

### Deploy with Docker

```bash
cd examples/deployment/docker
docker-compose up -d
```

## Requirements

- **Node.js** >= 18
- For LLM examples: API keys for OpenAI/Anthropic
- For deployment: Docker, cloud CLI tools

## Contributing

Have an example to share? Open a PR!
