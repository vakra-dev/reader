/**
 * Daemon Client
 *
 * A client that connects to the daemon server via HTTP.
 * Used by CLI commands when a daemon is running.
 *
 * @example
 * const client = new DaemonClient({ port: 3847 });
 *
 * const result = await client.scrape({
 *   urls: ['https://example.com'],
 *   formats: ['markdown'],
 * });
 */

import http from "http";
import type { ScrapeOptions, ScrapeResult } from "../types";
import type { CrawlOptions, CrawlResult } from "../crawl-types";
import type { DaemonStatus } from "./server";
import { DEFAULT_DAEMON_PORT } from "./server";

/**
 * Daemon client configuration
 */
export interface DaemonClientOptions {
  /** Port the daemon is running on (default: 3847) */
  port?: number;
  /** Request timeout in milliseconds (default: 600000 = 10 minutes) */
  timeoutMs?: number;
}

/**
 * Daemon Client
 */
export class DaemonClient {
  private options: Required<DaemonClientOptions>;

  constructor(options: DaemonClientOptions = {}) {
    this.options = {
      port: options.port ?? DEFAULT_DAEMON_PORT,
      timeoutMs: options.timeoutMs ?? 600000, // 10 minutes default
    };
  }

  /**
   * Scrape URLs via daemon
   */
  async scrape(options: Omit<ScrapeOptions, "connectionToCore">): Promise<ScrapeResult> {
    return this.request<ScrapeResult>({
      action: "scrape",
      options,
    });
  }

  /**
   * Crawl URL via daemon
   */
  async crawl(options: Omit<CrawlOptions, "connectionToCore">): Promise<CrawlResult> {
    return this.request<CrawlResult>({
      action: "crawl",
      options,
    });
  }

  /**
   * Get daemon status
   */
  async status(): Promise<DaemonStatus> {
    return this.request<DaemonStatus>({
      action: "status",
    });
  }

  /**
   * Request daemon shutdown
   */
  async shutdown(): Promise<void> {
    await this.request<{ message: string }>({
      action: "shutdown",
    });
  }

  /**
   * Check if daemon is reachable
   */
  async isRunning(): Promise<boolean> {
    try {
      await this.status();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Make HTTP request to daemon
   */
  private request<T>(body: object): Promise<T> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: this.options.port,
          path: "/",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
          },
          timeout: this.options.timeoutMs,
        },
        (res) => {
          let responseBody = "";

          res.on("data", (chunk) => {
            responseBody += chunk;
          });

          res.on("end", () => {
            try {
              const response = JSON.parse(responseBody);

              if (response.success) {
                resolve(response.data);
              } else {
                reject(new Error(response.error || "Unknown daemon error"));
              }
            } catch (error) {
              reject(new Error(`Failed to parse daemon response: ${responseBody}`));
            }
          });
        }
      );

      req.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ECONNREFUSED") {
          reject(new Error(`Cannot connect to daemon on port ${this.options.port}. Is it running?`));
        } else {
          reject(error);
        }
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`Request to daemon timed out after ${this.options.timeoutMs}ms`));
      });

      req.write(data);
      req.end();
    });
  }
}

/**
 * Check if daemon is running on the specified port
 */
export async function isDaemonRunning(port: number = DEFAULT_DAEMON_PORT): Promise<boolean> {
  const client = new DaemonClient({ port, timeoutMs: 5000 });
  return client.isRunning();
}
