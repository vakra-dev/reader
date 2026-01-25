/**
 * Job Queue API Server
 *
 * REST API for submitting and monitoring scrape jobs.
 * Jobs are processed asynchronously by the worker process.
 *
 * Usage: npx tsx src/index.ts
 */

import express, { Request, Response, NextFunction } from "express";
import {
  addScrapeJob,
  getJob,
  getQueueStats,
  scrapeQueue,
  connection,
  ScrapeJobData,
} from "./queue.js";

const app = express();
const PORT = process.env.PORT || 3002;

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
 * GET /health - Health check
 */
app.get("/health", async (req: Request, res: Response) => {
  try {
    // Check Redis connection
    await connection.ping();

    const stats = await getQueueStats();

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      queue: stats,
    });
  } catch (error: any) {
    res.status(503).json({
      status: "unhealthy",
      error: error.message,
    });
  }
});

/**
 * GET /stats - Queue statistics
 */
app.get("/stats", async (req: Request, res: Response) => {
  try {
    const stats = await getQueueStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /jobs - Submit a new scrape job
 *
 * Request body:
 * {
 *   urls: string[]          // Required: URLs to scrape
 *   formats?: string[]      // Optional: Output formats (default: ['markdown'])
 *   webhookUrl?: string     // Optional: URL to notify on completion
 *   priority?: number       // Optional: Job priority (lower = higher priority)
 *   delay?: number          // Optional: Delay in ms before processing
 * }
 */
app.post("/jobs", async (req: Request, res: Response) => {
  try {
    const { urls, formats, webhookUrl, priority, delay } = req.body;

    // Validation
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        error: "urls is required and must be a non-empty array",
      });
    }

    // Validate URLs
    for (const url of urls) {
      try {
        new URL(url);
      } catch {
        return res.status(400).json({
          error: `Invalid URL: ${url}`,
        });
      }
    }

    // Validate formats if provided
    const validFormats = ["markdown", "html", "json", "text"];
    if (formats) {
      if (!Array.isArray(formats) || !formats.every((f: string) => validFormats.includes(f))) {
        return res.status(400).json({
          error: `formats must be an array of: ${validFormats.join(", ")}`,
        });
      }
    }

    // Validate webhook URL if provided
    if (webhookUrl) {
      try {
        new URL(webhookUrl);
      } catch {
        return res.status(400).json({
          error: `Invalid webhook URL: ${webhookUrl}`,
        });
      }
    }

    // Create job data
    const jobData: ScrapeJobData = {
      urls,
      formats: formats || ["markdown"],
      webhookUrl,
      priority,
    };

    // Add job to queue
    const jobId = await addScrapeJob(jobData, { priority, delay });

    console.log(`[API] Job ${jobId} created: ${urls.length} URL(s)`);

    res.status(201).json({
      jobId,
      status: "queued",
      urls: urls.length,
      estimatedWait: delay ? `${delay}ms` : undefined,
    });
  } catch (error: any) {
    console.error("[API] Error creating job:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /jobs/:id - Get job status and result
 */
app.get("/jobs/:id", async (req: Request, res: Response) => {
  try {
    const job = await getJob(req.params.id);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const state = await job.getState();
    const progress = job.progress;
    const result = job.returnvalue;
    const failedReason = job.failedReason;

    res.json({
      id: job.id,
      state,
      progress,
      data: job.data,
      result: result || undefined,
      error: failedReason || undefined,
      timestamps: {
        created: job.timestamp,
        processed: job.processedOn,
        finished: job.finishedOn,
      },
      attempts: job.attemptsMade,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /jobs/:id - Cancel/remove a job
 */
app.delete("/jobs/:id", async (req: Request, res: Response) => {
  try {
    const job = await getJob(req.params.id);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const state = await job.getState();

    if (state === "active") {
      return res.status(400).json({
        error: "Cannot remove active job. Wait for it to complete or fail.",
      });
    }

    await job.remove();

    res.json({
      message: "Job removed",
      id: req.params.id,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /jobs/:id/retry - Retry a failed job
 */
app.post("/jobs/:id/retry", async (req: Request, res: Response) => {
  try {
    const job = await getJob(req.params.id);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const state = await job.getState();

    if (state !== "failed") {
      return res.status(400).json({
        error: `Cannot retry job in state: ${state}. Only failed jobs can be retried.`,
      });
    }

    await job.retry();

    res.json({
      message: "Job retried",
      id: req.params.id,
      newState: "waiting",
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Error handling
// ============================================================================

app.use((err: Error, req: Request, res: Response) => {
  console.error("[API Error]", err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

// ============================================================================
// Start server
// ============================================================================

async function startServer() {
  try {
    // Test Redis connection
    await connection.ping();
    console.log("[API] Redis connected");

    app.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════════════════════════╗
║       Reader - Job Queue API                            ║
╠════════════════════════════════════════════════════════════════╣
║  Server running on http://localhost:${PORT}                    ║
╠════════════════════════════════════════════════════════════════╣
║  Endpoints:                                                    ║
║    GET  /health        - Health check with queue stats         ║
║    GET  /stats         - Queue statistics                      ║
║    POST /jobs          - Submit a new scrape job               ║
║    GET  /jobs/:id      - Get job status and result             ║
║    DELETE /jobs/:id    - Remove a job                          ║
║    POST /jobs/:id/retry - Retry a failed job                   ║
╠════════════════════════════════════════════════════════════════╣
║  Note: Start the worker separately with: npm run worker        ║
╚════════════════════════════════════════════════════════════════╝
      `);
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log("\n[API] Shutting down...");
      await scrapeQueue.close();
      await connection.quit();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error: any) {
    console.error("[API] Failed to start:", error.message);
    process.exit(1);
  }
}

startServer();
