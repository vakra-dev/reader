/**
 * Browser Pool Scaling Example
 *
 * Demonstrates advanced browser pool configuration with:
 * - Pool metrics endpoint for monitoring
 * - Health checks with detailed status
 * - Graceful degradation under load
 * - Resource cleanup on shutdown
 *
 * Usage: npx tsx src/index.ts
 */

import express, { Request, Response, NextFunction } from "express";
import { ReaderClient } from "@vakra-dev/reader";
import type { BrowserPoolConfig } from "@vakra-dev/reader";

// ============================================================================
// Pool Configuration
// ============================================================================

const poolConfig: BrowserPoolConfig = {
  // Number of browser instances to maintain
  size: parseInt(process.env.POOL_SIZE || "4"),

  // Retire browser after N pages (prevents memory leaks)
  retireAfterPages: parseInt(process.env.RETIRE_AFTER_PAGES || "50"),

  // Retire browser after N minutes (15 minutes default)
  retireAfterMinutes: parseInt(process.env.RETIRE_AFTER_MINUTES || "15"),

  // Max pending requests in queue
  maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || "200"),
};

// ReaderClient instance (created at startup, shared across requests)
const reader = new ReaderClient({
  browserPool: poolConfig,
  verbose: process.env.VERBOSE === "true",
});

const app = express();
const PORT = process.env.PORT || 3003;
const serverStartTime = Date.now();

// Metrics tracked in-process
let totalRequests = 0;
let totalDurationMs = 0;

// Middleware
app.use(express.json({ limit: "1mb" }));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /health - Basic health check
 */
app.get("/health", async (_req: Request, res: Response) => {
  const uptime = Date.now() - serverStartTime;

  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime,
    uptimeFormatted: formatDuration(uptime),
    pool: {
      size: poolConfig.size,
      retireAfterPages: poolConfig.retireAfterPages,
      retireAfterMinutes: poolConfig.retireAfterMinutes,
      maxQueueSize: poolConfig.maxQueueSize,
    },
  });
});

/**
 * GET /metrics - Detailed pool metrics
 */
app.get("/metrics", (_req: Request, res: Response) => {
  const uptime = Date.now() - serverStartTime;
  const avgRequestDurationMs = totalRequests > 0 ? Math.round(totalDurationMs / totalRequests) : 0;

  res.json({
    pool: {
      size: poolConfig.size,
      maxQueueSize: poolConfig.maxQueueSize,
      retireAfterPages: poolConfig.retireAfterPages,
      retireAfterMinutes: poolConfig.retireAfterMinutes,
    },
    performance: {
      totalRequests,
      avgRequestDurationMs,
      uptimeMs: uptime,
    },
  });
});

/**
 * POST /scrape - Scrape a URL using the pool
 */
app.post("/scrape", async (req: Request, res: Response) => {
  const { url, formats = ["markdown"], waitForSelector, timeout } = req.body;

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

  const startTime = Date.now();

  try {
    const result = await reader.scrape({
      urls: [url],
      formats,
      waitForSelector,
      timeoutMs: timeout || 30000,
    });

    const duration = Date.now() - startTime;
    totalRequests++;
    totalDurationMs += duration;

    const page = result.data[0];

    res.json({
      success: page.success,
      url,
      title: page.metadata?.title,
      markdownLength: page.markdown?.length,
      durationMs: duration,
    });
  } catch (error: any) {
    const duration = Date.now() - startTime;

    console.error(`[Scrape] Error for ${url}:`, error.message);

    res.status(500).json({
      success: false,
      url,
      error: error.message,
      durationMs: duration,
    });
  }
});

/**
 * POST /batch - Scrape multiple URLs concurrently
 */
app.post("/batch", async (req: Request, res: Response) => {
  const { urls, concurrency = 2 } = req.body;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({
      success: false,
      error: "urls is required and must be a non-empty array",
    });
  }

  const startTime = Date.now();

  try {
    const result = await reader.scrape({
      urls,
      formats: ["markdown"],
      batchConcurrency: concurrency,
    });

    const duration = Date.now() - startTime;
    totalRequests += urls.length;
    totalDurationMs += duration;

    const successCount = result.data.filter((r) => r.success).length;

    res.json({
      success: true,
      summary: {
        total: urls.length,
        successful: successCount,
        failed: urls.length - successCount,
        durationMs: duration,
        avgPerUrl: Math.round(duration / urls.length),
      },
      results: result.data.map((r) => ({
        url: r.url,
        success: r.success,
        title: r.metadata?.title,
        error: r.error,
      })),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================================================
// Helpers
// ============================================================================

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

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

async function startServer() {
  try {
    console.log("[Pool] Starting ReaderClient...");
    await reader.start();
    console.log(`[Pool] Browser pool initialized (size: ${poolConfig.size})`);

    app.listen(PORT, () => {
      console.log(`
Reader - Browser Pool Scaling Example
  Server running on http://localhost:${PORT}
  Endpoints:
    GET  /health    - Health check with pool status
    GET  /metrics   - Pool metrics (JSON)
    POST /scrape    - Scrape a single URL
    POST /batch     - Scrape multiple URLs
  Pool Configuration:
    Size: ${poolConfig.size} browsers
    Retire after: ${poolConfig.retireAfterPages} pages or ${poolConfig.retireAfterMinutes}min
    Max queue: ${poolConfig.maxQueueSize} requests
      `);
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log("\n[Pool] Shutting down...");
      await reader.close();
      console.log("[Pool] Pool shutdown complete");
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error: any) {
    console.error("[Pool] Failed to start:", error.message);
    process.exit(1);
  }
}

startServer();
