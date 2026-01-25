#!/usr/bin/env node
/**
 * Proxy Pool Example
 *
 * Demonstrates configuring multiple proxies with rotation for scraping.
 * Useful for avoiding rate limits and IP blocks when scraping at scale.
 *
 * Usage:
 *   Set your proxy credentials and run:
 *   npx tsx basic/proxy-pool.ts
 */

import { ReaderClient } from "@vakra-dev/reader";

async function main() {
  console.log("Starting proxy pool example\n");

  // Configure proxy pool with rotation
  // Replace with your actual proxy credentials
  const reader = new ReaderClient({
    verbose: true,

    // List of proxies to rotate through
    proxies: [
      {
        host: "proxy1.example.com",
        port: 8080,
        username: "user1",
        password: "pass1",
        type: "datacenter",
      },
      {
        host: "proxy2.example.com",
        port: 8080,
        username: "user2",
        password: "pass2",
        type: "datacenter",
      },
      {
        host: "residential.example.com",
        port: 9000,
        username: "user3",
        password: "pass3",
        type: "residential",
        country: "us", // Geo-target to US
      },
    ],

    // Rotation strategy: "round-robin" (default) or "random"
    proxyRotation: "round-robin",
  });

  // URLs to scrape - each will use a different proxy from the pool
  const urls = [
    "https://example.com",
    "https://example.org",
    "https://example.net",
  ];

  console.log(`Scraping ${urls.length} URLs with proxy rotation\n`);
  console.log("Proxy rotation: round-robin");
  console.log("Proxy pool size: 3\n");

  try {
    const result = await reader.scrape({
      urls,
      formats: ["markdown"],
      batchConcurrency: 1, // Sequential to demonstrate rotation
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

      // Show which proxy was used (if available)
      if (page.metadata.proxy) {
        console.log(`     Proxy: ${page.metadata.proxy.host}:${page.metadata.proxy.port}`);
        if (page.metadata.proxy.country) {
          console.log(`     Country: ${page.metadata.proxy.country}`);
        }
      }
    }

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
