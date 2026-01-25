#!/usr/bin/env node
/**
 * Proxy Example
 *
 * Demonstrates scraping with a proxy configuration
 */

import { ReaderClient } from "@vakra-dev/reader";

async function main() {
  console.log("Starting proxy example\n");

  // Example proxy configurations:
  //
  // 1. Simple proxy URL:
  // proxy: { url: "http://user:pass@proxy.example.com:8080" }
  //
  // 2. Residential proxy with country targeting:
  // proxy: {
  //   type: "residential",
  //   host: "geo.iproyal.com",
  //   port: 12321,
  //   username: "customer-user",
  //   password: "password",
  //   country: "us"
  // }
  //
  // 3. Datacenter proxy:
  // proxy: {
  //   type: "datacenter",
  //   host: "proxy.example.com",
  //   port: 8080,
  //   username: "user",
  //   password: "pass"
  // }

  // For this example, we'll skip the proxy if not configured
  const proxyUrl = process.env.PROXY_URL;

  if (!proxyUrl) {
    console.log("No PROXY_URL environment variable set.");
    console.log("Set PROXY_URL=http://user:pass@host:port to test proxy scraping.");
    console.log("\nRunning without proxy...\n");
  }

  const reader = new ReaderClient({ verbose: true });

  try {
    const result = await reader.scrape({
      urls: ["https://httpbin.org/ip"], // Shows your IP address
      formats: ["text"],
      proxy: proxyUrl ? { url: proxyUrl } : undefined,
    });

    const page = result.data[0];

    if (!page) {
      console.error("No data returned - scrape may have failed");
      console.log("Errors:", result.batchMetadata.errors);
      process.exit(1);
    }

    console.log("\nScrape completed!");
    console.log("\nResponse (should show proxy IP if configured):");
    console.log(page.text);
  } catch (error: any) {
    console.error("Error:", error.message);
    process.exit(1);
  } finally {
    await reader.close();
  }
}

main();
