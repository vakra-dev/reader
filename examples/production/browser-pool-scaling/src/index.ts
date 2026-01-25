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
import { BrowserPool } from "@vakra-dev/reader";
import type { PoolConfig } from "@vakra-dev/reader";
import HeroCore from "@ulixee/hero-core";
import { TransportBridge } from "@ulixee/net";
import { ConnectionToHeroCore } from "@ulixee/hero";

// Global HeroCore instance
let heroCore: HeroCore | null = null;

function createConnectionToCore(): ConnectionToHeroCore {
  if (!heroCore) {
    throw new Error("HeroCore not initialized");
  }
  const bridge = new TransportBridge();
  heroCore.addConnection(bridge.transportToClient);
  return new ConnectionToHeroCore(bridge.transportToCore);
}

// ============================================================================
// Pool Configuration
// ============================================================================

const poolConfig: Partial<PoolConfig> = {
  // Number of browser instances to maintain
  size: parseInt(process.env.POOL_SIZE || "4"),

  // Retire browser after N pages (prevents memory leaks)
  retireAfterPageCount: parseInt(process.env.RETIRE_AFTER_PAGES || "50"),

  // Retire browser after N milliseconds (15 minutes default)
  retireAfterAgeMs: parseInt(process.env.RETIRE_AFTER_MS || String(15 * 60 * 1000)),

  // How often to check for browsers to recycle (1 minute)
  recycleCheckInterval: 60 * 1000,

  // Health check interval (5 minutes)
  healthCheckInterval: 5 * 60 * 1000,

  // Max failures before marking browser unhealthy
  maxConsecutiveFailures: 3,

  // Request queue settings
  maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || "200"),
  queueTimeout: parseInt(process.env.QUEUE_TIMEOUT || String(120 * 1000)),
};

// Pool instance (created after HeroCore starts)
let pool: BrowserPool;

const app = express();
const PORT = process.env.PORT || 3003;
const serverStartTime = Date.now();

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
app.get("/health", async (req: Request, res: Response) => {
  try {
    const health = await pool.healthCheck();
    const uptime = Date.now() - serverStartTime;

    res.status(health.healthy ? 200 : 503).json({
      status: health.healthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      uptime,
      uptimeFormatted: formatDuration(uptime),
      pool: {
        healthy: health.healthy,
        issues: health.issues,
      },
    });
  } catch (error: any) {
    res.status(503).json({
      status: "unhealthy",
      error: error.message,
    });
  }
});

/**
 * GET /metrics - Detailed pool metrics (Prometheus-compatible format available)
 */
app.get("/metrics", (req: Request, res: Response) => {
  const stats = pool.getStats();
  const format = req.query.format;

  if (format === "prometheus") {
    // Prometheus exposition format
    const lines = [
      `# HELP reader_pool_total Total browser instances in pool`,
      `# TYPE reader_pool_total gauge`,
      `reader_pool_total ${stats.total}`,
      ``,
      `# HELP reader_pool_available Available browser instances`,
      `# TYPE reader_pool_available gauge`,
      `reader_pool_available ${stats.available}`,
      ``,
      `# HELP reader_pool_busy Busy browser instances`,
      `# TYPE reader_pool_busy gauge`,
      `reader_pool_busy ${stats.busy}`,
      ``,
      `# HELP reader_pool_recycling Browser instances being recycled`,
      `# TYPE reader_pool_recycling gauge`,
      `reader_pool_recycling ${stats.recycling}`,
      ``,
      `# HELP reader_pool_unhealthy Unhealthy browser instances`,
      `# TYPE reader_pool_unhealthy gauge`,
      `reader_pool_unhealthy ${stats.unhealthy}`,
      ``,
      `# HELP reader_pool_queue_length Pending requests in queue`,
      `# TYPE reader_pool_queue_length gauge`,
      `reader_pool_queue_length ${stats.queueLength}`,
      ``,
      `# HELP reader_pool_requests_total Total requests processed`,
      `# TYPE reader_pool_requests_total counter`,
      `reader_pool_requests_total ${stats.totalRequests}`,
      ``,
      `# HELP reader_pool_request_duration_avg_ms Average request duration`,
      `# TYPE reader_pool_request_duration_avg_ms gauge`,
      `reader_pool_request_duration_avg_ms ${stats.avgRequestDuration.toFixed(2)}`,
    ];

    res.set("Content-Type", "text/plain; version=0.0.4");
    res.send(lines.join("\n"));
  } else {
    // JSON format
    res.json({
      pool: {
        total: stats.total,
        available: stats.available,
        busy: stats.busy,
        recycling: stats.recycling,
        unhealthy: stats.unhealthy,
        queueLength: stats.queueLength,
      },
      performance: {
        totalRequests: stats.totalRequests,
        avgRequestDurationMs: Math.round(stats.avgRequestDuration),
      },
      utilization: {
        percentage: stats.total > 0 ? Math.round((stats.busy / stats.total) * 100) : 0,
        status: getUtilizationStatus(stats),
      },
      config: {
        poolSize: poolConfig.size,
        retireAfterPageCount: poolConfig.retireAfterPageCount,
        retireAfterAgeMs: poolConfig.retireAfterAgeMs,
        maxQueueSize: poolConfig.maxQueueSize,
        queueTimeout: poolConfig.queueTimeout,
      },
    });
  }
});

/**
 * POST /scrape - Scrape a URL using the pool
 */
app.post("/scrape", async (req: Request, res: Response) => {
  const { url, waitForSelector, timeout } = req.body;

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

  const startTime = Date.now();

  try {
    const result = await pool.withBrowser(async (hero) => {
      // Navigate to URL
      await hero.goto(url);

      // Wait for selector if specified
      if (waitForSelector) {
        await hero.waitForElement(hero.document.querySelector(waitForSelector), {
          timeoutMs: timeout || 30000,
        });
      } else {
        await hero.waitForLoad("AllContentLoaded");
      }

      // Extract content
      const html = await hero.document.documentElement.outerHTML;
      const title = await hero.document.title;

      return { html, title };
    });

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      url,
      title: result.title,
      htmlLength: result.html.length,
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

  // Validation
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({
      success: false,
      error: "urls is required and must be a non-empty array",
    });
  }

  const startTime = Date.now();
  const results: Array<{ url: string; success: boolean; title?: string; error?: string }> = [];

  // Process URLs with limited concurrency
  const chunks: string[][] = [];
  for (let i = 0; i < urls.length; i += concurrency) {
    chunks.push(urls.slice(i, i + concurrency));
  }

  for (const chunk of chunks) {
    const chunkResults = await Promise.allSettled(
      chunk.map(async (url: string) => {
        try {
          const result = await pool.withBrowser(async (hero) => {
            await hero.goto(url);
            await hero.waitForLoad("AllContentLoaded");
            const title = await hero.document.title;
            return { url, success: true, title };
          });
          return result;
        } catch (error: any) {
          return { url, success: false, error: error.message };
        }
      })
    );

    for (const result of chunkResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        results.push({ url: "unknown", success: false, error: result.reason?.message });
      }
    }
  }

  const duration = Date.now() - startTime;
  const successCount = results.filter((r) => r.success).length;

  res.json({
    success: true,
    summary: {
      total: urls.length,
      successful: successCount,
      failed: urls.length - successCount,
      durationMs: duration,
      avgPerUrl: Math.round(duration / urls.length),
    },
    results,
  });
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

function getUtilizationStatus(stats: { total: number; busy: number; queueLength: number }): string {
  const utilization = stats.total > 0 ? stats.busy / stats.total : 0;

  if (stats.queueLength > 0) return "saturated";
  if (utilization > 0.8) return "high";
  if (utilization > 0.5) return "moderate";
  if (utilization > 0) return "low";
  return "idle";
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
    // Start HeroCore first
    console.log("[Pool] Starting HeroCore...");
    heroCore = new HeroCore();
    await heroCore.start();
    console.log("[Pool] HeroCore started");

    // Create pool with connection to HeroCore
    console.log("[Pool] Initializing browser pool...");
    pool = new BrowserPool(
      poolConfig,
      undefined, // proxy
      false, // showChrome
      createConnectionToCore()
    );
    await pool.initialize();
    console.log(`[Pool] Pool initialized with ${poolConfig.size} browsers`);

    app.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════════════════════════╗
║       Reader - Browser Pool Scaling Example             ║
╠════════════════════════════════════════════════════════════════╣
║  Server running on http://localhost:${PORT}                       ║
╠════════════════════════════════════════════════════════════════╣
║  Endpoints:                                                    ║
║    GET  /health           - Health check with pool status      ║
║    GET  /metrics          - Pool metrics (JSON or Prometheus)  ║
║    POST /scrape           - Scrape a single URL                ║
║    POST /batch            - Scrape multiple URLs               ║
╠════════════════════════════════════════════════════════════════╣
║  Pool Configuration:                                           ║
║    Size: ${poolConfig.size} browsers                                        ║
║    Retire after: ${poolConfig.retireAfterPageCount} pages or ${Math.round((poolConfig.retireAfterAgeMs || 0) / 60000)}min             ║
║    Max queue: ${poolConfig.maxQueueSize} requests                                ║
╚════════════════════════════════════════════════════════════════╝
      `);
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log("\n[Pool] Shutting down...");
      await pool.shutdown();
      if (heroCore) {
        await heroCore.close();
      }
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
