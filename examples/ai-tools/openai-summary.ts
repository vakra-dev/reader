/**
 * OpenAI Summarization Example
 *
 * Scrapes a webpage and uses OpenAI to summarize the content.
 *
 * Usage:
 *   npx tsx ai-tools/openai-summary.ts https://example.com
 *
 * Requirements:
 *   - Set OPENAI_API_KEY environment variable
 */

import { ReaderClient } from "@vakra-dev/reader";
import OpenAI from "openai";

async function main() {
  const url = process.argv[2] || "https://example.com";

  console.log(`Scraping ${url}...\n`);

  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY environment variable is required");
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
    console.log("Sending to OpenAI for summarization...\n");

    // Step 2: Summarize with OpenAI
    const openai = new OpenAI();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that summarizes web content. Provide a concise summary in 2-3 paragraphs.",
        },
        {
          role: "user",
          content: `Please summarize the following webpage content:\n\n${content.slice(0, 10000)}`,
        },
      ],
      max_tokens: 500,
    });

    const summary = completion.choices[0]?.message?.content;

    console.log("=== SUMMARY ===\n");
    console.log(summary);
    console.log("\n=== METADATA ===");
    console.log(`Source: ${url}`);
    console.log(`Content length: ${content.length} chars`);
    console.log(`Model: ${completion.model}`);
    console.log(`Tokens used: ${completion.usage?.total_tokens}`);
  } catch (error: any) {
    console.error("Error:", error.message);
    process.exit(1);
  } finally {
    await reader.close();
  }
}

main();
