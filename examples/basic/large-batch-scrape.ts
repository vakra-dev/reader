#!/usr/bin/env node
/**
 * Large-Scale Batch Scraping Example (1000 URLs)
 *
 * Demonstrates how to configure Reader for scraping
 * large batches of URLs efficiently.
 *
 * Key configurations for large batches:
 * - browserPool.size: More browsers = more parallelism
 * - browserPool.maxQueueSize: Must exceed total URL count
 * - batchConcurrency: How many URLs to process in parallel
 * - batchTimeoutMs: Must be long enough for all URLs
 *
 * Configuration Guide:
 * | URLs  | Pool Size | Concurrency | Queue Size | Timeout  | Est. Time   |
 * |-------|-----------|-------------|------------|----------|-------------|
 * | 100   | 5         | 5           | 100        | 10 min   | 3-5 min     |
 * | 500   | 8         | 8           | 500        | 30 min   | 15-25 min   |
 * | 1000  | 10        | 10          | 1000       | 1 hour   | 25-50 min   |
 * | 5000  | 10        | 10          | 5000       | 3 hours  | 2-4 hours   |
 *
 * Memory requirements:
 * - Each browser: ~100-300MB RAM
 * - 10 browsers: ~1-3GB RAM
 * - Recommended: 8GB+ system RAM for 10 browser instances
 */

import { ReaderClient } from "@vakra-dev/reader";

/**
 * Generate sample URLs for demonstration
 * In production, you'd load these from a file, database, or API
 */
function generateSampleUrls(count: number): string[] {
  // Using httpbin.org endpoints which are safe for testing
  const urls: string[] = [];
  for (let i = 0; i < count; i++) {
    // Rotate through different endpoints to simulate variety
    urls.push(`https://httpbin.org/html?page=${i}`);
  }
  return urls;
}

async function main() {
  // For demo purposes, use a smaller batch (10 URLs)
  // Change to 1000 for actual large-scale scraping
  const BATCH_SIZE = 10; // Set to 1000 for real large-scale scraping

  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║         Large-Scale Batch Scraping Example               ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝\n`);

  const urls = generateSampleUrls(BATCH_SIZE);
  console.log(`Preparing to scrape ${urls.length} URLs\n`);

  // Configure for large-scale scraping
  const reader = new ReaderClient({
    verbose: true,

    browserPool: {
      // More browsers = more parallelism (adjust based on RAM)
      // Each browser uses ~100-300MB RAM
      size: 10,

      // Queue must be large enough for all URLs
      maxQueueSize: 1000,

      // Recycle browsers more frequently with large batches
      retireAfterPages: 200,
      retireAfterMinutes: 30,
    },
  });

  const startTime = Date.now();
  let lastProgressUpdate = 0;

  try {
    const result = await reader.scrape({
      urls,
      formats: ["markdown"], // Use single format for efficiency

      // Match concurrency to browser pool size
      batchConcurrency: 10,

      // Long timeout for large batches (1 hour)
      batchTimeoutMs: 3600000,

      // Progress tracking
      onProgress: (progress) => {
        const now = Date.now();
        // Update every 5 seconds to avoid console spam
        if (now - lastProgressUpdate > 5000 || progress.completed === progress.total) {
          const elapsed = Math.round((now - startTime) / 1000);
          const rate = progress.completed / (elapsed || 1);
          const eta = Math.round((progress.total - progress.completed) / rate);

          console.log(
            `[${elapsed}s] Progress: ${progress.completed}/${progress.total} ` +
              `(${Math.round((progress.completed / progress.total) * 100)}%) ` +
              `| Rate: ${rate.toFixed(1)} URLs/s | ETA: ${eta}s`
          );
          lastProgressUpdate = now;
        }
      },
    });

    const duration = Date.now() - startTime;

    console.log(`\n╔══════════════════════════════════════════════════════════╗`);
    console.log(`║                    Batch Complete                        ║`);
    console.log(`╚══════════════════════════════════════════════════════════╝\n`);

    console.log(`Summary:`);
    console.log(`  Total URLs:      ${result.batchMetadata.totalUrls}`);
    console.log(`  Successful:      ${result.batchMetadata.successfulUrls}`);
    console.log(`  Failed:          ${result.batchMetadata.failedUrls}`);
    console.log(`  Total Duration:  ${Math.round(duration / 1000)}s`);
    console.log(`  Avg Per URL:     ${Math.round(duration / result.batchMetadata.totalUrls)}ms`);
    console.log(
      `  Throughput:      ${(result.batchMetadata.totalUrls / (duration / 1000)).toFixed(2)} URLs/s`
    );

    // Show failed URLs if any
    if (result.batchMetadata.errors && result.batchMetadata.errors.length > 0) {
      console.log(`\nFailed URLs:`);
      for (const error of result.batchMetadata.errors.slice(0, 10)) {
        console.log(`  - ${error.url}: ${error.error}`);
      }
      if (result.batchMetadata.errors.length > 10) {
        console.log(`  ... and ${result.batchMetadata.errors.length - 10} more`);
      }
    }

    // Sample output from successful scrapes
    if (result.data.length > 0) {
      console.log(`\nSample Results (first 3):`);
      for (const page of result.data.slice(0, 3)) {
        console.log(`  - ${page.metadata.baseUrl}`);
        console.log(`    Title: ${page.metadata.website.title || "N/A"}`);
        console.log(`    Content: ${page.markdown?.length || 0} chars`);
      }
    }
  } catch (error: any) {
    console.error("\nError:", error.message);
    process.exit(1);
  } finally {
    await reader.close();
    console.log("\nDone!");
  }
}

main();
