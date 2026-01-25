/**
 * LangChain Document Loader Example
 *
 * Creates a custom LangChain document loader using Reader.
 *
 * Usage:
 *   npx tsx ai-tools/langchain-loader.ts
 */

import { ReaderClient } from "@vakra-dev/reader";
import { Document } from "@langchain/core/documents";
import { BaseDocumentLoader } from "@langchain/core/document_loaders/base";

/**
 * Custom LangChain document loader powered by Reader
 */
class ReaderEngineLoader extends BaseDocumentLoader {
  private urls: string[];
  private crawlMode: boolean;
  private maxPages: number;
  private depth: number;
  private reader: ReaderClient;

  constructor(options: {
    urls: string[];
    crawl?: boolean;
    maxPages?: number;
    depth?: number;
    reader: ReaderClient;
  }) {
    super();
    this.urls = options.urls;
    this.crawlMode = options.crawl ?? false;
    this.maxPages = options.maxPages ?? 20;
    this.depth = options.depth ?? 1;
    this.reader = options.reader;
  }

  async load(): Promise<Document[]> {
    const documents: Document[] = [];

    if (this.crawlMode && this.urls.length === 1) {
      // Crawl mode: discover pages from a single seed URL
      const result = await this.reader.crawl({
        url: this.urls[0],
        depth: this.depth,
        maxPages: this.maxPages,
        scrape: true,
      });

      if (result.scraped) {
        for (const page of result.scraped.data) {
          documents.push(
            new Document({
              pageContent: page.markdown || "",
              metadata: {
                source: page.metadata.baseUrl,
                title: page.metadata.website.title,
                description: page.metadata.website.description,
                scrapedAt: page.metadata.scrapedAt,
              },
            })
          );
        }
      }
    } else {
      // Scrape mode: scrape specific URLs
      const result = await this.reader.scrape({
        urls: this.urls,
        formats: ["markdown"],
        batchConcurrency: 2,
      });

      for (const page of result.data) {
        documents.push(
          new Document({
            pageContent: page.markdown || "",
            metadata: {
              source: page.metadata.baseUrl,
              title: page.metadata.website.title,
              description: page.metadata.website.description,
              scrapedAt: page.metadata.scrapedAt,
            },
          })
        );
      }
    }

    return documents;
  }
}

// Example usage
async function main() {
  console.log("LangChain Document Loader Example\n");

  const reader = new ReaderClient({ verbose: true });

  try {
    // Example 1: Load specific URLs
    console.log("--- Example 1: Load specific URLs ---");
    const loader1 = new ReaderEngineLoader({
      urls: ["https://example.com", "https://example.org"],
      reader,
    });

    const docs1 = await loader1.load();
    console.log(`Loaded ${docs1.length} documents`);
    for (const doc of docs1) {
      console.log(`  - ${doc.metadata.source}: ${doc.pageContent.length} chars`);
    }

    // Example 2: Crawl a website
    console.log("\n--- Example 2: Crawl a website ---");
    const loader2 = new ReaderEngineLoader({
      urls: ["https://example.com"],
      crawl: true,
      depth: 1,
      maxPages: 5,
      reader,
    });

    const docs2 = await loader2.load();
    console.log(`Crawled and loaded ${docs2.length} documents`);
    for (const doc of docs2) {
      console.log(`  - ${doc.metadata.source}: ${doc.pageContent.length} chars`);
    }

    // The documents can now be used with LangChain:
    // - Text splitters for chunking
    // - Vector stores for embeddings
    // - RAG pipelines
    // - etc.
  } finally {
    await reader.close();
  }
}

main().catch(console.error);
