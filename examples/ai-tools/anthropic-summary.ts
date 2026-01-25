/**
 * Anthropic (Claude) Summarization Example
 *
 * Scrapes a webpage and uses Claude to summarize the content.
 *
 * Usage:
 *   npx tsx ai-tools/anthropic-summary.ts https://example.com
 *
 * Requirements:
 *   - Set ANTHROPIC_API_KEY environment variable
 */

import { ReaderClient } from "@vakra-dev/reader";
import Anthropic from "@anthropic-ai/sdk";

async function main() {
  const url = process.argv[2] || "https://example.com";

  console.log(`Scraping ${url}...\n`);

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  const reader = new ReaderClient();

  try {
    // Step 1: Scrape the webpage
    const result = await reader.scrape({
      urls: [url],
      formats: ["markdown"], // Markdown is best for LLM consumption
    });

    const content = result.data[0]?.markdown;
    if (!content) {
      console.error("No content scraped");
      process.exit(1);
    }

    console.log(`Scraped ${content.length} characters`);
    console.log("Sending to Claude for summarization...\n");

    // Step 2: Summarize with Claude
    const anthropic = new Anthropic();

    const message = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `Please summarize the following webpage content in 2-3 paragraphs:\n\n${content.slice(0, 10000)}`,
        },
      ],
    });

    const summary = message.content[0].type === "text" ? message.content[0].text : "";

    console.log("=== SUMMARY ===\n");
    console.log(summary);
    console.log("\n=== METADATA ===");
    console.log(`Source: ${url}`);
    console.log(`Content length: ${content.length} chars`);
    console.log(`Model: ${message.model}`);
    console.log(`Tokens: ${message.usage.input_tokens} in / ${message.usage.output_tokens} out`);
  } catch (error: any) {
    console.error("Error:", error.message);
    process.exit(1);
  } finally {
    await reader.close();
  }
}

main();
