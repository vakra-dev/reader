/**
 * Vercel AI SDK Streaming Example
 *
 * Scrapes a webpage and streams a summary using the Vercel AI SDK.
 *
 * Usage:
 *   npx tsx ai-tools/vercel-ai-stream.ts https://example.com
 *
 * Requirements:
 *   - Set OPENAI_API_KEY environment variable
 */

import { ReaderClient } from "@vakra-dev/reader";
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";

async function main() {
  const url = process.argv[2] || "https://example.com";

  console.log(`Scraping ${url}...\n`);

  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY environment variable is required");
    process.exit(1);
  }

  const reader = new ReaderClient({ verbose: true });

  try {
    // Step 1: Scrape the webpage
    const result = await reader.scrape({
      urls: [url],
      formats: ["text"],
      includeMetadata: false,
    });

    const content = result.data[0]?.text;
    if (!content) {
      console.error("No content scraped");
      process.exit(1);
    }

    console.log(`Scraped ${content.length} characters`);
    console.log("Streaming summary...\n");
    console.log("=== STREAMING SUMMARY ===\n");

    // Step 2: Stream summary with Vercel AI SDK
    const { textStream } = await streamText({
      model: openai("gpt-4o-mini"),
      system:
        "You are a helpful assistant that summarizes web content. Provide a concise summary in 2-3 paragraphs.",
      prompt: `Please summarize the following webpage content:\n\n${content.slice(0, 10000)}`,
      maxTokens: 500,
    });

    // Stream the response to stdout
    for await (const chunk of textStream) {
      process.stdout.write(chunk);
    }

    console.log("\n\n=== METADATA ===");
    console.log(`Source: ${url}`);
    console.log(`Content length: ${content.length} chars`);
  } catch (error: any) {
    console.error("Error:", error.message);
    process.exit(1);
  } finally {
    await reader.close();
  }
}

main();
