#!/usr/bin/env node
/**
 * Crawling Example
 *
 * Demonstrates website crawling with link discovery
 */

import { ReaderClient } from "@vakra-dev/reader";

async function main() {
  console.log("Starting crawl example\n");

  const seedUrl = process.argv[2] || "https://example.com";

  console.log(`Crawling: ${seedUrl}`);
  console.log(`   Depth: 2`);
  console.log(`   Max Pages: 10`);
  console.log(`   Scrape Content: true\n`);

  const reader = new ReaderClient({ verbose: true });

  try {
    const result = await reader.crawl({
      url: seedUrl,
      depth: 2,
      maxPages: 10,
      scrape: true,
    });

    console.log("\nCrawl completed!\n");
    console.log("Discovered URLs:");

    for (const crawlUrl of result.urls) {
      console.log(`\n  ${crawlUrl.url}`);
      console.log(`     Title: ${crawlUrl.title}`);
      if (crawlUrl.description) {
        console.log(`     Description: ${crawlUrl.description.slice(0, 100)}...`);
      }
    }

    console.log("\nCrawl Metadata:");
    console.log(`  Total URLs: ${result.metadata.totalUrls}`);
    console.log(`  Max Depth: ${result.metadata.maxDepth}`);
    console.log(`  Duration: ${result.metadata.totalDuration}ms`);
    console.log(`  Seed URL: ${result.metadata.seedUrl}`);

    if (result.scraped) {
      console.log("\nScraped Content:");
      console.log(`  Pages Scraped: ${result.scraped.batchMetadata.successfulUrls}`);
      console.log(
        `  Total Content: ${result.scraped.data.reduce(
          (acc, page) => acc + (page.markdown?.length || 0),
          0
        )} chars`
      );
    }
  } catch (error: any) {
    console.error("Error:", error.message);
    process.exit(1);
  } finally {
    await reader.close();
  }
}

main();
