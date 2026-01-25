/**
 * Queue Configuration
 *
 * Defines the BullMQ queue and job types for async scraping.
 */

import { Queue } from "bullmq";
import IORedis from "ioredis";

// Redis connection (shared across queue and workers)
export const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null, // Required by BullMQ
});

// Scrape job queue
export const scrapeQueue = new Queue("scrape", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 1000, // Keep last 1000 completed jobs
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours
    },
  },
});

/**
 * Scrape job input data
 */
export interface ScrapeJobData {
  /** URLs to scrape */
  urls: string[];
  /** Output formats */
  formats: string[];
  /** Optional webhook URL to notify on completion */
  webhookUrl?: string;
  /** Optional priority (lower = higher priority) */
  priority?: number;
}

/**
 * Scrape job result
 */
export interface ScrapeJobResult {
  success: boolean;
  data?: {
    batchMetadata: {
      totalUrls: number;
      successfulUrls: number;
      failedUrls: number;
      totalDurationMs: number;
    };
    results: Array<{
      url: string;
      success: boolean;
      markdown?: string;
      html?: string;
      json?: object;
      error?: string;
    }>;
  };
  error?: string;
}

/**
 * Add a scrape job to the queue
 */
export async function addScrapeJob(
  data: ScrapeJobData,
  options?: { priority?: number; delay?: number }
): Promise<string> {
  const job = await scrapeQueue.add("scrape", data, {
    priority: options?.priority ?? data.priority,
    delay: options?.delay,
  });
  return job.id!;
}

/**
 * Get job by ID
 */
export async function getJob(jobId: string) {
  return scrapeQueue.getJob(jobId);
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    scrapeQueue.getWaitingCount(),
    scrapeQueue.getActiveCount(),
    scrapeQueue.getCompletedCount(),
    scrapeQueue.getFailedCount(),
    scrapeQueue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}
