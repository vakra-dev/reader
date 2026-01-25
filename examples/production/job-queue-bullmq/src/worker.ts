/**
 * Scrape Worker
 *
 * Processes scrape jobs from the BullMQ queue.
 * Run this as a separate process from the API server.
 *
 * Usage: npx tsx src/worker.ts
 */

import { Worker, Job } from "bullmq";
import { ReaderClient } from "@vakra-dev/reader";
import { connection, ScrapeJobData, ScrapeJobResult } from "./queue.js";

// Shared ReaderClient instance
let reader: ReaderClient | null = null;

/**
 * Process a scrape job
 */
async function processJob(job: Job<ScrapeJobData>): Promise<ScrapeJobResult> {
  const { urls, formats, webhookUrl } = job.data;

  console.log(`[Worker] Processing job ${job.id}: ${urls.length} URL(s)`);

  if (!reader) {
    throw new Error("ReaderClient not initialized");
  }

  try {
    // Update progress: starting
    await job.updateProgress(10);

    // Perform scrape
    const result = await reader.scrape({
      urls,
      formats: formats as Array<"markdown" | "html">,
    });

    // Update progress: scraping complete
    await job.updateProgress(80);

    // Send webhook notification if configured
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "job.completed",
            jobId: job.id,
            timestamp: new Date().toISOString(),
            result: {
              success: true,
              batchMetadata: result.batchMetadata,
              urlCount: urls.length,
            },
          }),
        });
        console.log(`[Worker] Webhook sent to ${webhookUrl}`);
      } catch (webhookError) {
        console.error(`[Worker] Webhook failed:`, webhookError);
        // Don't fail the job if webhook fails
      }
    }

    // Update progress: complete
    await job.updateProgress(100);

    console.log(
      `[Worker] Job ${job.id} completed: ${result.batchMetadata.successfulUrls}/${result.batchMetadata.totalUrls} successful`
    );

    return {
      success: true,
      data: {
        batchMetadata: {
          totalUrls: result.batchMetadata.totalUrls,
          successfulUrls: result.batchMetadata.successfulUrls,
          failedUrls: result.batchMetadata.failedUrls,
          totalDurationMs: result.batchMetadata.totalDuration,
        },
        results: result.data.map((r) => ({
          url: r.metadata.baseUrl,
          success: true,
          markdown: r.markdown,
          html: r.html,
        })),
      },
    };
  } catch (error: any) {
    console.error(`[Worker] Job ${job.id} failed:`, error.message);

    // Send failure webhook if configured
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "job.failed",
            jobId: job.id,
            timestamp: new Date().toISOString(),
            error: error.message,
          }),
        });
      } catch {
        // Ignore webhook errors on failure
      }
    }

    throw error; // Re-throw to mark job as failed
  }
}

/**
 * Start the worker
 */
async function startWorker() {
  console.log("[Worker] Starting ReaderClient...");

  // Initialize ReaderClient
  reader = new ReaderClient({ verbose: true });
  await reader.start();

  console.log("[Worker] ReaderClient started");

  // Create worker
  const worker = new Worker<ScrapeJobData, ScrapeJobResult>("scrape", processJob, {
    connection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || "2"),
    limiter: {
      max: 10,
      duration: 1000, // Max 10 jobs per second
    },
  });

  // Event handlers
  worker.on("completed", (job) => {
    console.log(`[Worker] Job ${job.id} completed successfully`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[Worker] Job ${job?.id} failed:`, error.message);
  });

  worker.on("error", (error) => {
    console.error("[Worker] Worker error:", error);
  });

  console.log(`
╔════════════════════════════════════════════════════════════════╗
║       Reader - BullMQ Worker                            ║
╠════════════════════════════════════════════════════════════════╣
║  Worker started and listening for jobs                         ║
║  Concurrency: ${process.env.WORKER_CONCURRENCY || "2"} jobs                                          ║
║  Redis: ${process.env.REDIS_URL || "redis://localhost:6379"}                            ║
╚════════════════════════════════════════════════════════════════╝
  `);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[Worker] Shutting down...");

    // Close worker (waits for active jobs to complete)
    await worker.close();

    // Close ReaderClient
    if (reader) {
      await reader.close();
    }

    // Close Redis connection
    await connection.quit();

    console.log("[Worker] Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Start worker
startWorker().catch((error) => {
  console.error("[Worker] Failed to start:", error);
  process.exit(1);
});
