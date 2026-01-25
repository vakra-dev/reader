/**
 * LlamaIndex Document Loader Example
 *
 * Creates a custom LlamaIndex document loader using Reader.
 *
 * Usage:
 *   npx tsx ai-tools/llamaindex-loader.ts
 */

import { ReaderClient } from "@vakra-dev/reader";
import { Document } from "llamaindex";

/**
 * Load documents from URLs using Reader
 */
async function loadDocuments(reader: ReaderClient, urls: string[]): Promise<Document[]> {
  const result = await reader.scrape({
    urls,
    formats: ["text", "markdown"],
    batchConcurrency: 2,
  });

  return result.data.map(
    (page) =>
      new Document({
        text: page.text || page.markdown || "",
        metadata: {
          source: page.metadata.baseUrl,
          title: page.metadata.website.title ?? undefined,
          description: page.metadata.website.description ?? undefined,
          scrapedAt: page.metadata.scrapedAt,
        },
      })
  );
}

/**
 * Crawl a website and load all discovered pages as documents
 */
async function crawlAndLoadDocuments(
  reader: ReaderClient,
  url: string,
  options: { depth?: number; maxPages?: number } = {}
): Promise<Document[]> {
  const result = await reader.crawl({
    url,
    depth: options.depth ?? 1,
    maxPages: options.maxPages ?? 20,
    scrape: true,
  });

  if (!result.scraped) {
    return [];
  }

  return result.scraped.data.map(
    (page) =>
      new Document({
        text: page.text || page.markdown || "",
        metadata: {
          source: page.metadata.baseUrl,
          title: page.metadata.website.title ?? undefined,
          description: page.metadata.website.description ?? undefined,
          scrapedAt: page.metadata.scrapedAt,
        },
      })
  );
}

// Example usage
async function main() {
  console.log("LlamaIndex Document Loader Example\n");

  const reader = new ReaderClient({ verbose: true });

  try {
    // Example 1: Load specific URLs
    console.log("--- Example 1: Load specific URLs ---");
    const docs1 = await loadDocuments(reader, ["https://example.com", "https://example.org"]);
    console.log(`Loaded ${docs1.length} documents`);
    for (const doc of docs1) {
      console.log(`  - ${doc.metadata.source}: ${doc.getText().length} chars`);
    }

    // Example 2: Crawl a website
    console.log("\n--- Example 2: Crawl a website ---");
    const docs2 = await crawlAndLoadDocuments(reader, "https://example.com", {
      depth: 1,
      maxPages: 5,
    });
    console.log(`Crawled and loaded ${docs2.length} documents`);
    for (const doc of docs2) {
      console.log(`  - ${doc.metadata.source}: ${doc.getText().length} chars`);
    }

    // The documents can now be used with LlamaIndex:
    // - VectorStoreIndex for similarity search
    // - SummaryIndex for summarization
    // - KnowledgeGraphIndex for graph-based retrieval
  } finally {
    await reader.close();
  }
}

main().catch(console.error);
