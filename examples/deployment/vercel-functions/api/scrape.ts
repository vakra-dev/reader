/**
 * Vercel Serverless Function for Reader
 *
 * NOTE: Vercel Functions have similar limitations to AWS Lambda.
 * For browser workloads, consider using Vercel Edge Functions with
 * a remote browser service, or deploy to a different platform.
 *
 * This example demonstrates connecting to an external browser service.
 */

import { scrape } from "@vakra-dev/reader";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// Use a remote browser service (recommended for serverless)
const BROWSER_WS_ENDPOINT = process.env.BROWSER_WS_ENDPOINT;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed",
    });
  }

  try {
    const { urls, formats } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        success: false,
        error: "urls is required and must be a non-empty array",
      });
    }

    // Limit URLs per request (serverless timeout constraints)
    if (urls.length > 3) {
      return res.status(400).json({
        success: false,
        error: "Maximum 3 URLs per request",
      });
    }

    // Check for browser endpoint
    if (!BROWSER_WS_ENDPOINT) {
      return res.status(500).json({
        success: false,
        error: "BROWSER_WS_ENDPOINT not configured. Set up Browserless, Browserbase, or similar.",
      });
    }

    const result = await scrape({
      urls,
      formats: formats || ["markdown"],
      batchConcurrency: 1,
      timeoutMs: 25000, // Leave buffer for Vercel timeout
      connectionToCore: BROWSER_WS_ENDPOINT,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      batchMetadata: result.batchMetadata,
    });
  } catch (error: any) {
    console.error("Vercel function error:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
}

export const config = {
  maxDuration: 30, // Maximum execution time in seconds
};
