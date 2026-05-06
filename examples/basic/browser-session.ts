#!/usr/bin/env node
/**
 * Browser Session Example
 *
 * Demonstrates the browser() primitive — launches a Hero-stealthed
 * Chrome and returns a CDP WebSocket URL for Playwright/Puppeteer.
 *
 * This example:
 * 1. Creates a browser session via ReaderClient
 * 2. Connects Playwright via connectOverCDP (one-line change)
 * 3. Navigates to Hacker News and extracts the top stories
 * 4. Takes a screenshot
 * 5. Cleans up the session
 *
 * Install: npm install playwright-core
 * Run:     npx tsx examples/basic/browser-session.ts
 */

import { ReaderClient } from "@vakra-dev/reader";
import { chromium } from "playwright-core";

async function main() {
  const reader = new ReaderClient({ verbose: true });

  try {
    // Create a browser session — returns a CDP WebSocket URL
    console.log("Creating browser session...\n");
    const session = await reader.browser({
      timeoutMs: 60_000,
      verbose: true,
      showChrome: true,
    });
    console.log(`\nSession ready: ${session.wsEndpoint}\n`);

    // Connect Playwright — this is the only line that changes
    // from a normal Playwright script
    const browser = await chromium.connectOverCDP(session.wsEndpoint);
    const context = await browser.newContext();
    const page = await context.newPage();

    // Navigate to Hacker News
    console.log("Navigating to Hacker News...");
    await page.goto("https://news.ycombinator.com/", {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });

    console.log(`Title: ${await page.title()}`);
    console.log(`URL: ${page.url()}\n`);

    // Extract the top 10 stories
    const stories = await page.evaluate(() => {
      const rows = document.querySelectorAll(".athing");
      return Array.from(rows)
        .slice(0, 10)
        .map((row) => {
          const titleEl = row.querySelector(".titleline > a");
          const siteEl = row.querySelector(".sitestr");
          const scoreRow = row.nextElementSibling;
          const scoreEl = scoreRow?.querySelector(".score");
          return {
            rank: row.querySelector(".rank")?.textContent?.trim(),
            title: titleEl?.textContent?.trim(),
            url: titleEl?.getAttribute("href"),
            site: siteEl?.textContent?.trim() ?? null,
            points: scoreEl?.textContent?.trim() ?? null,
          };
        });
    });

    console.log("Top 10 Hacker News stories:");
    console.log("─".repeat(60));
    for (const story of stories) {
      console.log(`${story.rank} ${story.title}`);
      if (story.site) console.log(`   ${story.site} | ${story.points ?? "no score"}`);
      console.log();
    }

    // Take a screenshot
    await page.screenshot({ fullPage: true, path: "hn-screenshot.png" });
    console.log(`Screenshot saved to hn-screenshot.png\n`);

    // Stealth check
    const stealth = await page.evaluate(() => ({
      webdriver: (navigator as any).webdriver,
      languages: navigator.languages,
    }));
    console.log(
      `Stealth: webdriver=${stealth.webdriver}, languages=${JSON.stringify(stealth.languages)}`
    );

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
