# AI Tools Examples

Examples showing how to integrate Reader with AI frameworks, LLMs, and vector stores.

## Prerequisites

Start Ulixee Cloud in a separate terminal:

```bash
npx @ulixee/cloud start
```

## Examples

### LLM Summarization

Scrape webpages and summarize with LLMs.

| Example | Description | API Key Required |
|---------|-------------|------------------|
| [openai-summary.ts](./openai-summary.ts) | Summarize with GPT | `OPENAI_API_KEY` |
| [anthropic-summary.ts](./anthropic-summary.ts) | Summarize with Claude | `ANTHROPIC_API_KEY` |
| [vercel-ai-stream.ts](./vercel-ai-stream.ts) | Streaming summary with Vercel AI SDK | `OPENAI_API_KEY` |

```bash
export OPENAI_API_KEY="sk-..."
npx tsx ai-tools/openai-summary.ts https://example.com

export ANTHROPIC_API_KEY="sk-ant-..."
npx tsx ai-tools/anthropic-summary.ts https://example.com
```

### RAG Frameworks

Load scraped content into RAG frameworks for retrieval-augmented generation.

| Example | Description |
|---------|-------------|
| [langchain-loader.ts](./langchain-loader.ts) | Custom LangChain document loader |
| [llamaindex-loader.ts](./llamaindex-loader.ts) | LlamaIndex document loader |

```bash
npx tsx ai-tools/langchain-loader.ts
npx tsx ai-tools/llamaindex-loader.ts
```

### Vector Stores

Scrape and ingest content directly into vector databases for semantic search.

| Example | Description | API Keys Required |
|---------|-------------|-------------------|
| [pinecone-ingest.ts](./pinecone-ingest.ts) | Ingest into Pinecone | `PINECONE_API_KEY`, `OPENAI_API_KEY` |
| [qdrant-ingest.ts](./qdrant-ingest.ts) | Ingest into Qdrant | `OPENAI_API_KEY`, optionally `QDRANT_URL` |

```bash
# Pinecone
export PINECONE_API_KEY="..."
export OPENAI_API_KEY="sk-..."
npx tsx ai-tools/pinecone-ingest.ts

# Qdrant (local)
docker run -p 6333:6333 qdrant/qdrant
export OPENAI_API_KEY="sk-..."
npx tsx ai-tools/qdrant-ingest.ts
```

## Tips

- Use `markdown` format for LLM input (cleaner than HTML)
- Truncate content if it exceeds token limits
- For production, consider chunking large documents before embedding
