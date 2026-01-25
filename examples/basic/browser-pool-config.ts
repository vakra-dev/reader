#!/usr/bin/env node
/**
 * Browser Pool Configuration Example
 *
 * Demonstrates configuring the browser pool for high-throughput scraping.
 * Useful when scraping many URLs to optimize performance and resource usage.
 */

import { ReaderClient } from "@vakra-dev/reader";

async function main() {
  console.log("Starting browser pool configuration example\n");

  // Configure browser pool for high-throughput scraping
  const reader = new ReaderClient({
    verbose: true,

    // Browser pool configuration
    browserPool: {
      size: 5, // Run 5 browser instances in parallel
      retireAfterPages: 50, // Recycle browser after 50 pages (prevents memory leaks)
      retireAfterMinutes: 15, // Recycle browser after 15 minutes
      maxQueueSize: 200, // Allow up to 200 pending requests in queue
    },
  });

  // Sample URLs to scrape
  const urls = [
    "https://example.com",
    "https://example.org",
    "https://example.net",
  ];

  console.log(`Scraping ${urls.length} URLs with pool size=5, concurrency=3\n`);

  try {
    const result = await reader.scrape({
      urls,
      formats: ["markdown"],
      batchConcurrency: 3, // Process 3 URLs in parallel
      onProgress: (progress) => {
        console.log(`Progress: ${progress.completed}/${progress.total} - ${progress.currentUrl}`);
      },
    });

    console.log("\nScrape completed!\n");
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
