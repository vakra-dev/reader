#!/usr/bin/env node
/**
 * Basic Scraping Example
 *
 * Demonstrates simple single-URL scraping with reader
 */

import { ReaderClient } from "@vakra-dev/reader";

async function main() {
  console.log("Starting basic scrape example\n");

  const reader = new ReaderClient({ verbose: true });

  try {
    const result = await reader.scrape({
      urls: ["https://example.com"],
      formats: ["markdown", "html"],
    });

    const page = result.data[0];

    if (!page) {
      console.error("No data returned - scrape may have failed");
      console.log("Errors:", result.batchMetadata.errors);
      process.exit(1);
    }

    console.log("\nScrape completed!");
    console.log("\nResults:");
    console.log(`  URL: ${page.metadata.baseUrl}`);
    console.log(`  Title: ${page.metadata.website.title}`);
    console.log(`  Duration: ${page.metadata.duration}ms`);
    console.log(`  Markdown length: ${page.markdown?.length || 0} chars`);
    console.log(`  HTML length: ${page.html?.length || 0} chars`);

    console.log("\nMarkdown Preview (first 500 chars):");
    console.log(page.markdown?.slice(0, 500));

    console.log("\nBatch Metadata:");
    console.log(`  Total URLs: ${result.batchMetadata.totalUrls}`);
    console.log(`  Successful: ${result.batchMetadata.successfulUrls}`);
    console.log(`  Failed: ${result.batchMetadata.failedUrls}`);
    console.log(`  Total Duration: ${result.batchMetadata.totalDuration}ms`);
  } catch (error: any) {
    console.error("Error:", error.message);
    process.exit(1);
  } finally {
    await reader.close();
  }
}

main();
