#!/usr/bin/env node
/**
 * Batch Scraping Example
 *
 * Demonstrates concurrent scraping of multiple URLs
 */

import { ReaderClient } from "@vakra-dev/reader";

async function main() {
  console.log("Starting batch scrape example\n");

  const urls = ["https://example.com", "https://example.org", "https://example.net"];

  console.log(`Scraping ${urls.length} URLs with concurrency=2\n`);

  const reader = new ReaderClient({ verbose: true });

  try {
    const result = await reader.scrape({
      urls,
      formats: ["markdown"],
      batchConcurrency: 2, // Process 2 URLs in parallel
      onProgress: (progress) => {
        console.log(`\nProgress: ${progress.completed}/${progress.total} - ${progress.currentUrl}`);
      },
    });

    console.log("\nBatch scrape completed!\n");
    console.log("Results:");

    for (const page of result.data) {
      console.log(`\n  ${page.metadata.baseUrl}`);
      console.log(`     Title: ${page.metadata.website.title}`);
      console.log(`     Duration: ${page.metadata.duration}ms`);
      console.log(`     Content: ${page.markdown?.length || 0} chars`);
    }

    console.log("\nBatch Metadata:");
    console.log(`  Total URLs: ${result.batchMetadata.totalUrls}`);
    console.log(`  Successful: ${result.batchMetadata.successfulUrls}`);
    console.log(`  Failed: ${result.batchMetadata.failedUrls}`);
    console.log(`  Total Duration: ${result.batchMetadata.totalDuration}ms`);
    console.log(
      `  Avg Per URL: ${Math.round(
        result.batchMetadata.totalDuration / result.batchMetadata.totalUrls
      )}ms`
    );
  } catch (error: any) {
    console.error("Error:", error.message);
    process.exit(1);
  } finally {
    await reader.close();
  }
}

main();
