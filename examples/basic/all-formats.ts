#!/usr/bin/env node
/**
 * All Formats Example
 *
 * Demonstrates outputting content in all supported formats
 */

import { ReaderClient } from "@vakra-dev/reader";

async function main() {
  console.log("Starting all-formats example\n");

  const reader = new ReaderClient({ verbose: true });

  try {
    const result = await reader.scrape({
      urls: ["https://example.com"],
      formats: ["markdown", "html", "json", "text"],
    });

    const page = result.data[0];

    if (!page) {
      console.error("No data returned - scrape may have failed");
      console.log("Errors:", result.batchMetadata.errors);
      process.exit(1);
    }

    console.log("\nScrape completed!");
    console.log("\nFormat Lengths:");
    console.log(`  Markdown: ${page.markdown?.length || 0} chars`);
    console.log(`  HTML: ${page.html?.length || 0} chars`);
    console.log(`  JSON: ${page.json?.length || 0} chars`);
    console.log(`  Text: ${page.text?.length || 0} chars`);

    console.log("\n--- MARKDOWN OUTPUT ---");
    console.log(page.markdown?.slice(0, 500));

    console.log("\n--- TEXT OUTPUT ---");
    console.log(page.text?.slice(0, 500));

    console.log("\n--- JSON OUTPUT ---");
    console.log(page.json?.slice(0, 500));
  } catch (error: any) {
    console.error("Error:", error.message);
    process.exit(1);
  } finally {
    await reader.close();
  }
}

main();
