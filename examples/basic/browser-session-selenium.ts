#!/usr/bin/env node
/**
 * Browser Session — Selenium CDP Example
 *
 * Selenium 4+ supports direct CDP connections, bypassing chromedriver.
 * This uses Chrome's CDP WebSocket directly to navigate, extract data,
 * and take screenshots.
 *
 * Note: This bypasses chromedriver and uses raw CDP commands. For a
 * higher-level API, use Playwright or Puppeteer (see other examples).
 *
 * Install: npm install ws
 * Run:     npx tsx --tsconfig examples/tsconfig.json examples/basic/browser-session-selenium.ts
 */

import { ReaderClient } from "@vakra-dev/reader";
import WebSocket from "ws";
import { writeFileSync } from "fs";

/** Send a CDP command over a WebSocket */
function sendCDP(
  ws: WebSocket,
  cmdId: { value: number },
  method: string,
  params: any = {},
  sessionId?: string
): Promise<any> {
  const id = ++cmdId.value;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 15_000);
    const handler = (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        ws.off("message", handler);
        clearTimeout(timeout);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
  });
}

async function main() {
  const reader = new ReaderClient();

  try {
    // Create a browser session
    const session = await reader.browser({ timeoutMs: 60_000, verbose: true, showChrome: true });
    console.log(`Session: ${session.wsEndpoint}\n`);

    const url = new URL(session.wsEndpoint);
    const baseUrl = `http://${url.hostname}:${url.port}`;

    // Get browser info via Chrome's HTTP debug API
    const versionResp = await fetch(`${baseUrl}/json/version`);
    const version = await versionResp.json();
    console.log(`Browser: ${version.Browser}`);

    // Connect to the browser via CDP WebSocket
    const ws = new WebSocket(session.wsEndpoint);
    await new Promise<void>((resolve) => ws.on("open", resolve));

    const cmdId = { value: 0 };
    const send = (method: string, params: any = {}) => sendCDP(ws, cmdId, method, params);

    // Create a new page target via CDP
    const target = await send("Target.createTarget", {
      url: "about:blank",
    });
    console.log(`Page created: ${target.targetId}\n`);

    // Attach to the page target to get a session
    const attached = await send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    const pageSessionId = attached.sessionId;

    // Helper to send commands to the page session
    const sendPage = (method: string, params: any = {}) =>
      sendCDP(ws, cmdId, method, params, pageSessionId);

    // Enable page events
    await sendPage("Page.enable");
    await sendPage("Runtime.enable");

    // Navigate to Hacker News
    console.log("Navigating to Hacker News...");
    await sendPage("Page.navigate", {
      url: "https://news.ycombinator.com/",
    });

    // Wait for load
    await new Promise<void>((resolve) => {
      const handler = (data: WebSocket.Data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === "Page.loadEventFired") {
          ws.off("message", handler);
          resolve();
        }
      };
      ws.on("message", handler);
    });

    // Get page title
    const titleResult = await sendPage("Runtime.evaluate", {
      expression: "document.title",
    });
    console.log(`Title: ${titleResult.result.value}\n`);

    // Extract top 5 stories
    const storiesResult = await sendPage("Runtime.evaluate", {
      expression: `JSON.stringify(
        Array.from(document.querySelectorAll('.athing')).slice(0, 5).map(row => {
          const rank = row.querySelector('.rank')?.textContent?.trim();
          const title = row.querySelector('.titleline > a')?.textContent?.trim();
          return rank + ' ' + title;
        })
      )`,
    });
    const stories = JSON.parse(storiesResult.result.value);
    console.log("Top 5 stories:");
    for (const s of stories) {
      console.log(`  ${s}`);
    }

    // Stealth check
    const wdResult = await sendPage("Runtime.evaluate", {
      expression: "navigator.webdriver",
    });
    console.log(`\nwebdriver: ${wdResult.result.value}`);

    // Take a screenshot
    const screenshotResult = await sendPage("Page.captureScreenshot", {
      format: "png",
    });
    writeFileSync("hn-selenium-cdp.png", Buffer.from(screenshotResult.data, "base64"));
    console.log("Screenshot saved to hn-selenium-cdp.png");

    // Cleanup
    ws.close();
    await session.close();
    console.log("\nDone.");
  } finally {
    await reader.close();
    process.exit(0);
  }
}

main();
