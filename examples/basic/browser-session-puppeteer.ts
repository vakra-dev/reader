#!/usr/bin/env node
/**
 * Browser Session — Puppeteer Example
 *
 * Same browser session primitive, but using Puppeteer instead of
 * Playwright. Puppeteer connects via browserWSEndpoint.
 *
 * Install: npm install puppeteer-core
 * Run:     npx tsx --tsconfig examples/tsconfig.json examples/basic/browser-session-puppeteer.ts
 */

import { ReaderClient } from "@vakra-dev/reader";
import { connect } from "puppeteer-core";

async function main() {
  const reader = new ReaderClient();

  try {
    // Create a browser session
    const session = await reader.browser({ timeoutMs: 60_000, verbose: true, showChrome: true });
    console.log(`Session: ${session.wsEndpoint}\n`);

    // Connect Puppeteer — uses browserWSEndpoint instead of connectOverCDP
    const browser = await connect({
      browserWSEndpoint: session.wsEndpoint,
      defaultViewport: null,
    });

    const page = await browser.newPage();

    // Navigate to Hacker News
    console.log("Navigating to Hacker News...");
    await page.goto("https://news.ycombinator.com/", {
      waitUntil: "domcontentloaded",
    });
    console.log(`Title: ${await page.title()}\n`);

    // Extract top stories using Puppeteer's evaluate
    const stories = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".athing"))
        .slice(0, 5)
        .map((row) => {
          const titleEl = row.querySelector(".titleline > a");
          const scoreRow = row.nextElementSibling;
          const scoreEl = scoreRow?.querySelector(".score");
          return {
            rank: row.querySelector(".rank")?.textContent?.trim(),
            title: titleEl?.textContent?.trim(),
            points: scoreEl?.textContent?.trim() ?? null,
          };
        });
    });

    console.log("Top 5 stories:");
    for (const s of stories) {
      console.log(`  ${s.rank} ${s.title} (${s.points ?? "no score"})`);
    }

    // Take a screenshot
    await page.screenshot({ path: "hn-puppeteer.png", fullPage: true });
    console.log("\nScreenshot saved to hn-puppeteer.png");

    // Stealth check
    const webdriver = await page.evaluate(() => (navigator as any).webdriver);
    console.log(`\nwebdriver: ${webdriver}`);

    // Cleanup
    await browser.close();
    await session.close();
    console.log("\nDone.");
  } finally {
    await reader.close();
    process.exit(0);
  }
}

main();
