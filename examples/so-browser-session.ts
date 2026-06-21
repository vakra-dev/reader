/**
 * Browser session example — access StackOverflow via CDP.
 *
 * This demonstrates the browser() primitive: Reader launches Chrome
 * and hands you a WebSocket URL. YOU control the browser.
 *
 * Usage: npx tsx examples/so-browser-session.ts
 */

import { chromium } from "playwright-core";
import { ReaderClient } from "../src/client.js";

async function main() {
  const reader = new ReaderClient({ verbose: true });

  const session = await reader.browser({ showChrome: true });
  console.log("\nSession:", session.sessionId);
  console.log("WebSocket:", session.wsEndpoint);

  const browser = await chromium.connectOverCDP(session.wsEndpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.newPage());

  console.log("\nNavigating to StackOverflow...");
  await page.goto("https://stackoverflow.com/questions/tagged/javascript", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // Wait for Cloudflare if needed
  const title = await page.title();
  if (title === "Just a moment...") {
    console.log("Cloudflare challenge detected, waiting...");
    await page.waitForFunction(
      () => document.title !== "Just a moment...",
      { timeout: 30000 }
    );
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  }

  console.log("\nTitle:", await page.title());
  console.log("Content length:", (await page.content()).length, "chars");

  await session.close();
  await reader.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
