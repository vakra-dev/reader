/**
 * Daemon Server
 *
 * An HTTP server that wraps ReaderClient, allowing multiple CLI
 * commands to share a single browser pool for efficient scraping.
 *
 * @example
 * // Start daemon
 * const daemon = new DaemonServer({ port: 3847, poolSize: 5 });
 * await daemon.start();
 *
 * // Stop daemon
 * await daemon.stop();
 */

import http from "http";
import { ReaderClient, type ReaderClientOptions } from "../client";
import type { ScrapeOptions, ScrapeResult } from "../types";
import type { CrawlOptions, CrawlResult } from "../crawl-types";
import { createLogger } from "../utils/logger";

const logger = createLogger("daemon");

export const DEFAULT_DAEMON_PORT = 3847;
const PID_FILE_NAME = ".reader-daemon.pid";

/**
 * Daemon server configuration
 */
export interface DaemonServerOptions {
  /** Port to listen on (default: 3847) */
  port?: number;
  /** Browser pool size (default: 5) */
  poolSize?: number;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
  /** Show Chrome browser windows (default: false) */
  showChrome?: boolean;
}

/**
 * Request body types
 */
interface ScrapeRequest {
  action: "scrape";
  options: Omit<ScrapeOptions, "connectionToCore">;
}

interface CrawlRequest {
  action: "crawl";
  options: Omit<CrawlOptions, "connectionToCore">;
}

interface StatusRequest {
  action: "status";
}

interface ShutdownRequest {
  action: "shutdown";
}

type DaemonRequest = ScrapeRequest | CrawlRequest | StatusRequest | ShutdownRequest;

/**
 * Response types
 */
interface SuccessResponse<T> {
  success: true;
  data: T;
}

interface ErrorResponse {
  success: false;
  error: string;
}

type DaemonResponse<T> = SuccessResponse<T> | ErrorResponse;

/**
 * Status response data
 */
export interface DaemonStatus {
  running: true;
  port: number;
  poolSize: number;
  uptime: number;
  pid: number;
}

/**
 * Daemon Server
 */
export class DaemonServer {
  private server: http.Server | null = null;
  private client: ReaderClient | null = null;
  private options: Required<DaemonServerOptions>;
  private startTime: number = 0;

  constructor(options: DaemonServerOptions = {}) {
    this.options = {
      port: options.port ?? DEFAULT_DAEMON_PORT,
      poolSize: options.poolSize ?? 5,
      verbose: options.verbose ?? false,
      showChrome: options.showChrome ?? false,
    };
  }

  /**
   * Start the daemon server
   */
  async start(): Promise<void> {
    if (this.server) {
      throw new Error("Daemon is already running");
    }

    // Initialize ReaderClient
    const clientOptions: ReaderClientOptions = {
      verbose: this.options.verbose,
      showChrome: this.options.showChrome,
      browserPool: {
        size: this.options.poolSize,
      },
    };

    this.client = new ReaderClient(clientOptions);
    await this.client.start();

    // Create HTTP server
    this.server = http.createServer(this.handleRequest.bind(this));

    // Start listening
    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.options.port, () => {
        this.startTime = Date.now();
        if (this.options.verbose) {
          logger.info(`Daemon started on port ${this.options.port} with pool size ${this.options.poolSize}`);
        }
        resolve();
      });

      this.server!.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          reject(new Error(`Port ${this.options.port} is already in use. Is another daemon running?`));
        } else {
          reject(error);
        }
      });
    });

    // Write PID file
    await this.writePidFile();
  }

  /**
   * Stop the daemon server
   */
  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    if (this.client) {
      await this.client.close();
      this.client = null;
    }

    // Remove PID file
    await this.removePidFile();

    if (this.options.verbose) {
      logger.info("Daemon stopped");
    }
  }

  /**
   * Get the port the daemon is running on
   */
  getPort(): number {
    return this.options.port;
  }

  /**
   * Handle incoming HTTP requests
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Only accept POST requests to /
    if (req.method !== "POST" || req.url !== "/") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "Not found" }));
      return;
    }

    // Parse request body
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    let request: DaemonRequest;
    try {
      request = JSON.parse(body);
    } catch {
      this.sendResponse(res, 400, { success: false, error: "Invalid JSON" });
      return;
    }

    // Handle request
    try {
      switch (request.action) {
        case "scrape":
          await this.handleScrape(res, request.options);
          break;
        case "crawl":
          await this.handleCrawl(res, request.options);
          break;
        case "status":
          this.handleStatus(res);
          break;
        case "shutdown":
          await this.handleShutdown(res);
          break;
        default:
          this.sendResponse(res, 400, { success: false, error: "Unknown action" });
      }
    } catch (error: any) {
      this.sendResponse(res, 500, { success: false, error: error.message });
    }
  }

  /**
   * Handle scrape request
   */
  private async handleScrape(
    res: http.ServerResponse,
    options: Omit<ScrapeOptions, "connectionToCore">
  ): Promise<void> {
    if (!this.client) {
      this.sendResponse(res, 500, { success: false, error: "Client not initialized" });
      return;
    }

    const result = await this.client.scrape(options);
    this.sendResponse<ScrapeResult>(res, 200, { success: true, data: result });
  }

  /**
   * Handle crawl request
   */
  private async handleCrawl(
    res: http.ServerResponse,
    options: Omit<CrawlOptions, "connectionToCore">
  ): Promise<void> {
    if (!this.client) {
      this.sendResponse(res, 500, { success: false, error: "Client not initialized" });
      return;
    }

    const result = await this.client.crawl(options);
    this.sendResponse<CrawlResult>(res, 200, { success: true, data: result });
  }

  /**
   * Handle status request
   */
  private handleStatus(res: http.ServerResponse): void {
    const status: DaemonStatus = {
      running: true,
      port: this.options.port,
      poolSize: this.options.poolSize,
      uptime: Date.now() - this.startTime,
      pid: process.pid,
    };
    this.sendResponse<DaemonStatus>(res, 200, { success: true, data: status });
  }

  /**
   * Handle shutdown request
   */
  private async handleShutdown(res: http.ServerResponse): Promise<void> {
    this.sendResponse(res, 200, { success: true, data: { message: "Shutting down" } });

    // Delay shutdown to allow response to be sent
    setTimeout(() => {
      this.stop().then(() => process.exit(0));
    }, 100);
  }

  /**
   * Send JSON response
   */
  private sendResponse<T>(res: http.ServerResponse, statusCode: number, data: DaemonResponse<T>): void {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  /**
   * Write PID file
   */
  private async writePidFile(): Promise<void> {
    const fs = await import("fs/promises");
    const path = await import("path");
    const os = await import("os");

    const pidFile = path.join(os.tmpdir(), PID_FILE_NAME);
    const data = JSON.stringify({
      pid: process.pid,
      port: this.options.port,
      startedAt: new Date().toISOString(),
    });

    await fs.writeFile(pidFile, data);
  }

  /**
   * Remove PID file
   */
  private async removePidFile(): Promise<void> {
    const fs = await import("fs/promises");
    const path = await import("path");
    const os = await import("os");

    const pidFile = path.join(os.tmpdir(), PID_FILE_NAME);
    try {
      await fs.unlink(pidFile);
    } catch {
      // Ignore errors
    }
  }
}

/**
 * Get path to PID file
 */
export async function getPidFilePath(): Promise<string> {
  const path = await import("path");
  const os = await import("os");
  return path.join(os.tmpdir(), PID_FILE_NAME);
}

/**
 * Check if daemon is running by reading PID file
 */
export async function getDaemonInfo(): Promise<{ pid: number; port: number; startedAt: string } | null> {
  const fs = await import("fs/promises");
  const pidFile = await getPidFilePath();

  try {
    const data = await fs.readFile(pidFile, "utf-8");
    const info = JSON.parse(data);

    // Check if process is still running
    try {
      process.kill(info.pid, 0); // Signal 0 tests if process exists
      return info;
    } catch {
      // Process not running, clean up stale PID file
      await fs.unlink(pidFile).catch(() => {});
      return null;
    }
  } catch {
    return null;
  }
}
