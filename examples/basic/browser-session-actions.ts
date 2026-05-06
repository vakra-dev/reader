#!/usr/bin/env node
/**
 * Browser Session — Actions Example
 *
 * Demonstrates performing browser actions: clicking, typing, form
 * submission, waiting for elements, and extracting structured data.
 *
 * Uses Playwright to search Hacker News and extract results.
 *
 * Install: npm install playwright-core
 * Run:     npx tsx --tsconfig examples/tsconfig.json examples/basic/browser-session-actions.ts
 */

import { ReaderClient } from "@vakra-dev/reader";
import { chromium } from "playwright-core";

async function main() {
  const reader = new ReaderClient();

  try {
    // Create a browser session
    const session = await reader.browser({ timeoutMs: 60_000, verbose: true, showChrome: true });
    console.log(`Session: ${session.wsEndpoint}\n`);

    // Connect Playwright — one-line change from a local script
    const browser = await chromium.connectOverCDP(session.wsEndpoint);
    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Navigate to Hacker News
    console.log("1. Navigating to Hacker News...");
    await page.goto("https://news.ycombinator.com/", {
      waitUntil: "domcontentloaded",
    });
    console.log(`   Title: ${await page.title()}\n`);

    // 2. Click the "past" link in the nav
    console.log("2. Clicking 'past' link...");
    await page.click('a[href="front"]');
    await page.waitForLoadState("domcontentloaded");
    console.log(`   URL: ${page.url()}`);
    console.log(`   Title: ${await page.title()}\n`);

    // 3. Go to the search page (Algolia-powered)
    console.log("3. Navigating to HN Search...");
    await page.goto("https://hn.algolia.com/", {
      waitUntil: "domcontentloaded",
    });

    // 4. Type a search query (use type() for character-by-character input
    //    so Algolia's instant search triggers properly)
    console.log('4. Typing search query "web scraping"...');
    await page.locator('input[type="search"]').pressSequentially("web scraping", { delay: 50 });

    // 5. Wait for search results to settle
    console.log("5. Waiting for search results...");
    await page.waitForTimeout(3_000);

    // 6. Extract search results
    console.log("6. Extracting results...\n");
    const results = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".Story"))
        .slice(0, 5)
        .map((el) => {
          const titleEl = el.querySelector(".Story_title a");
          const metaLinks = el.querySelectorAll(".Story_meta a");
          return {
            title: titleEl?.textContent?.trim(),
            points: metaLinks[0]?.textContent?.trim() ?? null,
            author: metaLinks[1]?.textContent?.trim() ?? null,
          };
        });
    });

    console.log('Search results for "web scraping":');
    console.log("─".repeat(60));
    for (const r of results) {
      console.log(`  ${r.title}`);
      console.log(`    ${r.points} | by ${r.author}`);
      console.log();
    }

    // 7. Take a screenshot of the search results
    await page.screenshot({ path: "hn-search-results.png" });
    console.log("Screenshot saved to hn-search-results.png\n");

    // 8. Get cookies
    const cookies = await context.cookies();
    console.log(`Cookies: ${cookies.length} cookies set`);

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
