#!/usr/bin/env node
/**
 * Cloudflare Bypass Example
 *
 * Demonstrates scraping a Cloudflare-protected website.
 * Reader automatically detects and handles Cloudflare challenges
 * using TLS fingerprinting, DNS over TLS, and WebRTC masking.
 *
 * Test URL: https://www.scrapingcourse.com/cloudflare-challenge
 */

import { ReaderClient } from "@vakra-dev/reader";

async function main() {
  console.log("Starting Cloudflare bypass example\n");

  // Cloudflare-protected test URL
  const url = process.argv[2] || "https://www.scrapingcourse.com/cloudflare-challenge";

  console.log(`Target: ${url}`);
  console.log("This site is protected by Cloudflare challenge.\n");

  const reader = new ReaderClient({
    verbose: true,
    showChrome: false, // Set to true to watch the bypass in action
  });

  try {
    console.log("Scraping (Cloudflare bypass handled automatically)...\n");

    const result = await reader.scrape({
      urls: [url],
      formats: ["markdown", "text"],
      timeoutMs: 5000, // Allow extra time for challenge resolution
    });

    const page = result.data[0];

    if (!page) {
      console.error("No data returned - scrape may have failed");
      console.log("Errors:", result.batchMetadata.errors);
      process.exit(1);
    }

    console.log("\nScrape completed successfully!");
    console.log("\nResults:");
    console.log(`  URL: ${page.metadata.baseUrl}`);
    console.log(`  Title: ${page.metadata.website.title}`);
    console.log(`  Duration: ${page.metadata.duration}ms`);
    console.log(`  Content length: ${page.markdown?.length || 0} chars`);

    console.log("\n--- CONTENT PREVIEW (first 500 chars) ---\n");
    console.log(page.text?.slice(0, 500) || page.markdown?.slice(0, 500));

    console.log("\n--- METADATA ---");
    console.log(`  Description: ${page.metadata.website.description || "N/A"}`);
  } catch (error: any) {
    console.error("Error:", error.message);
    console.log("\nTip: If the challenge fails, try:");
    console.log("  - Increasing timeoutMs");
    console.log("  - Using --show-chrome to debug visually");
    console.log("  - Using a residential proxy");
    process.exit(1);
  } finally {
    await reader.close();
  }
}

main();
