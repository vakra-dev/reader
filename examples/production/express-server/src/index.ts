/**
 * Express Server Example for Reader
 *
 * Demonstrates how to run Reader as a REST API.
 * Uses ReaderClient which manages the HeroCore lifecycle internally.
 *
 * Key concepts:
 * - Initialize ReaderClient once at startup
 * - Reuse the same client for all requests
 * - Graceful shutdown to properly close the client
 */

import express, { Request, Response, NextFunction } from "express";
import { ReaderClient } from "@vakra-dev/reader";
import type { ScrapeResult, CrawlResult } from "@vakra-dev/reader";

// Global ReaderClient instance (initialized in startServer)
let reader: ReaderClient | null = null;

const app = express();
const PORT = process.env.PORT || 3001;
const serverStartTime = Date.now();

// Middleware
app.use(express.json({ limit: "10mb" }));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /health - Health check endpoint
 */
app.get("/health", (req: Request, res: Response) => {
  const uptime = Date.now() - serverStartTime;

  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime,
    uptimeFormatted: `${Math.floor(uptime / 1000)}s`,
  });
});

/**
 * POST /scrape - Scrape one or more URLs
 *
 * Request body:
 * {
 *   urls: string[]              // Required
 *   formats?: string[]          // Default: ['markdown']
 *   batchConcurrency?: number   // Default: 1
 *   waitForSelector?: string
 *   screenshot?: boolean
 *   verbose?: boolean
 *   showChrome?: boolean
 *   proxy?: ProxyConfig
 * }
 */
app.post("/scrape", async (req: Request, res: Response) => {
  try {
    const { urls, formats, ...options } = req.body;

    // Validation
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        success: false,
        error: "urls is required and must be a non-empty array",
      });
    }

    // Validate URLs
    for (const url of urls) {
      try {
        new URL(url);
      } catch {
        return res.status(400).json({
          success: false,
          error: `Invalid URL: ${url}`,
        });
      }
    }

    // Validate formats if provided
    if (formats) {
      const validFormats = ["markdown", "html", "json"];
      if (!Array.isArray(formats) || !formats.every((f: string) => validFormats.includes(f))) {
        return res.status(400).json({
          success: false,
          error: "formats must be an array of: markdown, html, json",
        });
      }
    }

    console.log(`[scrape] Starting scrape of ${urls.length} URL(s)`);

    if (!reader) {
      throw new Error("ReaderClient not initialized");
    }

    const result: ScrapeResult = await reader.scrape({
      urls,
      formats: formats || ["markdown"],
      ...options,
    });

    console.log(
      `[scrape] Completed: ${result.batchMetadata.successfulUrls}/${result.batchMetadata.totalUrls} successful`
    );

    res.json({
      success: true,
      data: result.data,
      batchMetadata: result.batchMetadata,
    });
  } catch (error: any) {
    console.error("[scrape] Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Scrape failed",
    });
  }
});

/**
 * POST /crawl - Crawl a website
 *
 * Request body:
 * {
 *   url: string        // Required - seed URL
 *   depth?: number     // Default: 1, max: 5
 *   maxPages?: number  // Default: 20, max: 100
 *   scrape?: boolean   // Also scrape full content
 * }
 */
app.post("/crawl", async (req: Request, res: Response) => {
  try {
    const { url, depth, maxPages, scrape: shouldScrape } = req.body;

    // Validation
    if (!url || typeof url !== "string") {
      return res.status(400).json({
        success: false,
        error: "url is required and must be a string",
      });
    }

    try {
      new URL(url);
    } catch {
      return res.status(400).json({
        success: false,
        error: `Invalid URL: ${url}`,
      });
    }

    // Validate depth
    if (depth !== undefined && (typeof depth !== "number" || depth < 0 || depth > 5)) {
      return res.status(400).json({
        success: false,
        error: "depth must be a number between 0 and 5",
      });
    }

    // Validate maxPages
    if (
      maxPages !== undefined &&
      (typeof maxPages !== "number" || maxPages < 1 || maxPages > 100)
    ) {
      return res.status(400).json({
        success: false,
        error: "maxPages must be a number between 1 and 100",
      });
    }

    console.log(`[crawl] Starting crawl of ${url} (depth: ${depth || 1})`);

    if (!reader) {
      throw new Error("ReaderClient not initialized");
    }

    const result: CrawlResult = await reader.crawl({
      url,
      depth: depth || 1,
      maxPages: maxPages || 20,
      scrape: shouldScrape || false,
    });

    console.log(`[crawl] Completed: found ${result.urls.length} URLs`);

    res.json({
      success: true,
      urls: result.urls,
      scraped: result.scraped
        ? {
            success: true,
            data: result.scraped.data,
            batchMetadata: result.scraped.batchMetadata,
          }
        : undefined,
      metadata: result.metadata,
    });
  } catch (error: any) {
    console.error("[crawl] Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Crawl failed",
    });
  }
});

// ============================================================================
// Error handling
// ============================================================================

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error("[Server Error]", err);
  res.status(500).json({
    success: false,
    error: err.message || "Internal server error",
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: `Not found: ${req.method} ${req.path}`,
  });
});

// ============================================================================
// Start server
// ============================================================================

// Initialize ReaderClient and start Express server
async function startServer() {
  try {
    // Initialize ReaderClient (starts HeroCore internally)
    reader = new ReaderClient({ verbose: true });
    await reader.start();
    console.log("[reader] ReaderClient started");

    app.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════════════════════════╗
║       Reader - Express Server Example                   ║
╠════════════════════════════════════════════════════════════════╣
║  Server running on http://localhost:${PORT}                    ║
╠════════════════════════════════════════════════════════════════╣
║  Endpoints:                                                    ║
║    GET  /health  - Health check                                ║
║    POST /scrape  - Scrape URLs                                 ║
║    POST /crawl   - Crawl website                               ║
╚════════════════════════════════════════════════════════════════╝
      `);
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log("\n[reader] Shutting down...");
      if (reader) {
        await reader.close();
      }
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (err: any) {
    console.error("[reader] Failed to start:", err.message);
    process.exit(1);
  }
}

startServer();
