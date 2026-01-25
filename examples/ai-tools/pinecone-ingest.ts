/**
 * Pinecone Vector Store Ingestion Example
 *
 * Scrapes webpages and ingests them into Pinecone for semantic search.
 *
 * Usage:
 *   npx tsx ai-tools/pinecone-ingest.ts
 *
 * Requirements:
 *   - Set PINECONE_API_KEY environment variable
 *   - Set OPENAI_API_KEY environment variable (for embeddings)
 *   - Create a Pinecone index with dimension 1536 (for text-embedding-3-small)
 */

import { ReaderClient } from "@vakra-dev/reader";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";

const INDEX_NAME = "reader-docs";

async function main() {
  // Check for required API keys
  if (!process.env.PINECONE_API_KEY) {
    console.error("Error: PINECONE_API_KEY environment variable is required");
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY environment variable is required");
    process.exit(1);
  }

  console.log("Pinecone Vector Store Ingestion Example\n");

  // Initialize clients
  const pinecone = new Pinecone();
  const openai = new OpenAI();
  const reader = new ReaderClient({ verbose: true });

  try {
    // Step 1: Scrape webpages
    const urls = ["https://example.com", "https://example.org"];

    console.log(`Scraping ${urls.length} URLs...`);
    const result = await reader.scrape({
      urls,
      formats: ["markdown"],
      batchConcurrency: 2,
    });

    console.log(`Scraped ${result.batchMetadata.successfulUrls} pages`);

    // Step 2: Generate embeddings and prepare vectors
    console.log("\nGenerating embeddings...");
    const index = pinecone.index(INDEX_NAME);

    const vectors = [];
    for (const page of result.data) {
      const content = page.markdown || "";
      if (!content) continue;

      // Truncate content to fit embedding model limits
      const truncatedContent = content.slice(0, 8000);

      // Generate embedding
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: truncatedContent,
      });

      const embedding = embeddingResponse.data[0].embedding;

      vectors.push({
        id: Buffer.from(page.metadata.baseUrl).toString("base64"),
        values: embedding,
        metadata: {
          url: page.metadata.baseUrl,
          title: page.metadata.website.title || "",
          description: page.metadata.website.description || "",
          content: truncatedContent.slice(0, 1000), // Store preview in metadata
          scrapedAt: page.metadata.scrapedAt,
        },
      });

      console.log(`  - Embedded: ${page.metadata.baseUrl}`);
    }

    // Step 3: Upsert to Pinecone
    console.log(`\nUpserting ${vectors.length} vectors to Pinecone...`);
    await index.upsert(vectors);

    console.log("\nDone! Vectors are now searchable in Pinecone.");
    console.log(`Index: ${INDEX_NAME}`);

    // Example: Query the index
    console.log("\n--- Example Query ---");
    const queryText = "example domain";
    const queryEmbedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: queryText,
    });

    const queryResponse = await index.query({
      vector: queryEmbedding.data[0].embedding,
      topK: 3,
      includeMetadata: true,
    });

    console.log(`Query: "${queryText}"`);
    console.log("Results:");
    for (const match of queryResponse.matches) {
      console.log(`  - ${match.metadata?.title} (score: ${match.score?.toFixed(3)})`);
      console.log(`    URL: ${match.metadata?.url}`);
    }
  } finally {
    await reader.close();
  }
}

main().catch(console.error);
