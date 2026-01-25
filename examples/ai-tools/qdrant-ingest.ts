/**
 * Qdrant Vector Store Ingestion Example
 *
 * Scrapes webpages and ingests them into Qdrant for semantic search.
 *
 * Usage:
 *   npx tsx ai-tools/qdrant-ingest.ts
 *
 * Requirements:
 *   - Set QDRANT_URL environment variable (default: http://localhost:6333)
 *   - Set QDRANT_API_KEY environment variable (optional, for Qdrant Cloud)
 *   - Set OPENAI_API_KEY environment variable (for embeddings)
 */

import { ReaderClient } from "@vakra-dev/reader";
import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";

const COLLECTION_NAME = "reader-docs";
const VECTOR_SIZE = 1536; // text-embedding-3-small dimension

async function main() {
  // Check for required API keys
  if (!process.env.OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY environment variable is required");
    process.exit(1);
  }

  console.log("Qdrant Vector Store Ingestion Example\n");

  // Initialize clients
  const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";
  const qdrant = new QdrantClient({
    url: qdrantUrl,
    apiKey: process.env.QDRANT_API_KEY,
  });
  const openai = new OpenAI();
  const reader = new ReaderClient({ verbose: true });

  try {
    // Ensure collection exists
    try {
      await qdrant.getCollection(COLLECTION_NAME);
      console.log(`Using existing collection: ${COLLECTION_NAME}`);
    } catch {
      console.log(`Creating collection: ${COLLECTION_NAME}`);
      await qdrant.createCollection(COLLECTION_NAME, {
        vectors: {
          size: VECTOR_SIZE,
          distance: "Cosine",
        },
      });
    }

    // Step 1: Scrape webpages
    const urls = ["https://example.com", "https://example.org"];

    console.log(`\nScraping ${urls.length} URLs...`);
    const result = await reader.scrape({
      urls,
      formats: ["text"],
      batchConcurrency: 2,
    });

    console.log(`Scraped ${result.batchMetadata.successfulUrls} pages`);

    // Step 2: Generate embeddings and prepare points
    console.log("\nGenerating embeddings...");
    const points = [];

    for (let i = 0; i < result.data.length; i++) {
      const page = result.data[i];
      const content = page.text || "";
      if (!content) continue;

      // Truncate content to fit embedding model limits
      const truncatedContent = content.slice(0, 8000);

      // Generate embedding
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: truncatedContent,
      });

      const embedding = embeddingResponse.data[0].embedding;

      points.push({
        id: i + 1, // Qdrant requires positive integers or UUIDs
        vector: embedding,
        payload: {
          url: page.metadata.baseUrl,
          title: page.metadata.website.title || "",
          description: page.metadata.website.description || "",
          content: truncatedContent.slice(0, 1000), // Store preview in payload
          scrapedAt: page.metadata.scrapedAt,
        },
      });

      console.log(`  - Embedded: ${page.metadata.baseUrl}`);
    }

    // Step 3: Upsert to Qdrant
    console.log(`\nUpserting ${points.length} points to Qdrant...`);
    await qdrant.upsert(COLLECTION_NAME, {
      wait: true,
      points,
    });

    console.log("\nDone! Points are now searchable in Qdrant.");
    console.log(`Collection: ${COLLECTION_NAME}`);
    console.log(`Qdrant URL: ${qdrantUrl}`);

    // Example: Query the collection
    console.log("\n--- Example Query ---");
    const queryText = "example domain";
    const queryEmbedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: queryText,
    });

    const searchResponse = await qdrant.search(COLLECTION_NAME, {
      vector: queryEmbedding.data[0].embedding,
      limit: 3,
      with_payload: true,
    });

    console.log(`Query: "${queryText}"`);
    console.log("Results:");
    for (const result of searchResponse) {
      console.log(`  - ${result.payload?.title} (score: ${result.score.toFixed(3)})`);
      console.log(`    URL: ${result.payload?.url}`);
    }
  } finally {
    await reader.close();
  }
}

main().catch(console.error);
