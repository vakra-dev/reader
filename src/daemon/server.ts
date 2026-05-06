/**
 * Daemon Server
 *
 * An HTTP server that wraps ReaderClient, allowing multiple CLI
 * commands to share a single browser pool for efficient scraping.
 *
 * Endpoints:
 *   POST /          — Scrape/crawl/status/shutdown (JSON body with "action" field)
 *   GET  /health    — Liveness check (always 200 if server is up)
 *   GET  /ready     — Readiness check (200 only after browser pool is warm)
 *   GET  /status    — Pool stats, uptime, and engine info
 *
 * Auth:
 *   Set READER_AUTH_TOKEN env var to require Bearer token on all endpoints
 *   except /health (liveness should always be unauthenticated).
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
import type { BrowserOptions, BrowserSession } from "../browser-types";
import { createLogger } from "../utils/logger";
import { parseProxyPoolsFromEnv } from "../proxy/env";
import { verifyProxiesOrThrow } from "../proxy/verify";
import { redactProxyUrl } from "../browser/proxy-bound-browser";

const logger = createLogger("daemon");

export const DEFAULT_DAEMON_PORT = 6003;
const PID_FILE_NAME = ".reader-daemon.pid";
const SHUTDOWN_TIMEOUT_MS = 30_000;

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
  /** Bearer token for API authentication (default: READER_AUTH_TOKEN env var) */
  authToken?: string;
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

interface BrowserCreateRequest {
  action: "browser.create";
  options: Omit<BrowserOptions, "connectionToCore">;
}

interface BrowserStopRequest {
  action: "browser.stop";
  sessionId: string;
}

interface BrowserListRequest {
  action: "browser.list";
}

type DaemonRequest =
  | ScrapeRequest
  | CrawlRequest
  | StatusRequest
  | ShutdownRequest
  | BrowserCreateRequest
  | BrowserStopRequest
  | BrowserListRequest;

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
  ready: boolean;
  port: number;
  poolSize: number;
  uptime: number;
  pid: number;
  activeRequests: number;
}

/**
 * Serializable browser session info (without the close function)
 */
export interface BrowserSessionInfo {
  sessionId: string;
  wsEndpoint: string;
  createdAt: string;
}

/**
 * Daemon Server
 */
export class DaemonServer {
  private server: http.Server | null = null;
  private client: ReaderClient | null = null;
  private options: Required<DaemonServerOptions>;
  private startTime: number = 0;
  private activeRequests: number = 0;
  private shuttingDown: boolean = false;
  private browserSessions = new Map<string, BrowserSession>();

  constructor(options: DaemonServerOptions = {}) {
    this.options = {
      port: options.port ?? DEFAULT_DAEMON_PORT,
      poolSize: options.poolSize ?? 5,
      verbose: options.verbose ?? false,
      showChrome: options.showChrome ?? false,
      authToken: options.authToken ?? process.env.READER_AUTH_TOKEN ?? "",
    };
  }

  /**
   * Start the daemon server
   */
  async start(): Promise<void> {
    if (this.server) {
      throw new Error("Daemon is already running");
    }

    // Load proxy pools from PROXY_DATACENTER / PROXY_RESIDENTIAL env vars.
    // Throws on malformed URLs — we refuse to start with a bad proxy config
    // rather than silently falling through to direct connections, which
    // would hide the misconfiguration behind partial successes.
    const { pools: proxyPools, summary: proxySummary } = parseProxyPoolsFromEnv();
    logger.info(proxySummary);

    // Verify each configured proxy by GETting api.ipify.org through it.
    // This catches dead URLs, wrong creds, and reachability problems BEFORE
    // we spend the cost of launching N Hero instances. Throws a clear
    // multi-line error if any proxy fails — the daemon won't start with a
    // broken config.
    if (proxyPools) {
      logger.info("Verifying proxies via api.ipify.org...");
      const verified = await verifyProxiesOrThrow(proxyPools);
      for (const v of verified) {
        logger.info(`  ✓ [${v.tier}] ${redactProxyUrl(v.proxyUrl)} -> egress IP ${v.egressIp}`);
      }
    }

    // Initialize ReaderClient
    const clientOptions: ReaderClientOptions = {
      verbose: this.options.verbose,
      showChrome: this.options.showChrome,
      browserPool: {
        size: this.options.poolSize,
      },
      ...(proxyPools ? { proxyPools } : {}),
    };

    this.client = new ReaderClient(clientOptions);
    await this.client.start();

    // Guard against uncaught exceptions from Hero internals.
    // Hero's MITM proxy can throw after a page closes (e.g.,
    // Resources.onMitmError accessing null framesManager). These
    // are non-fatal race conditions — the scrape already failed,
    // this is cleanup code hitting a null reference. Log and continue.
    process.on("uncaughtException", (err) => {
      logger.error({ err }, "Uncaught exception (non-fatal, Hero internal)");
    });

    // Create HTTP server
    this.server = http.createServer(this.handleRequest.bind(this));

    // Start listening
    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.options.port, () => {
        this.startTime = Date.now();
        if (this.options.verbose) {
          logger.info(
            `Daemon started on port ${this.options.port} with pool size ${this.options.poolSize}`
          );
        }
        resolve();
      });

      this.server!.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          reject(
            new Error(`Port ${this.options.port} is already in use. Is another daemon running?`)
          );
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
   * Validate Bearer token if auth is configured
   * Returns true if authorized, false if rejected (response already sent).
   */
  private checkAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    if (!this.options.authToken) return true;

    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${this.options.authToken}`) {
      this.sendResponse(res, 401, { success: false, error: "Unauthorized" });
      return false;
    }
    return true;
  }

  /**
   * Handle incoming HTTP requests
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const requestId = req.headers["x-request-id"] as string | undefined;
    if (requestId) res.setHeader("x-request-id", requestId);

    // --- GET endpoints ---

    // Liveness: always 200 if process is up (no auth required)
    if (method === "GET" && url === "/health") {
      this.sendResponse(res, 200, { success: true, data: { status: "ok" } });
      return;
    }

    // Readiness: 200 only after pool is warm
    if (method === "GET" && url === "/ready") {
      if (!this.checkAuth(req, res)) return;
      const ready = this.client?.isReady() ?? false;
      if (ready) {
        this.sendResponse(res, 200, { success: true, data: { ready: true } });
      } else {
        this.sendResponse(res, 503, { success: false, error: "Not ready — pool is initializing" });
      }
      return;
    }

    // Status: pool stats + uptime
    if (method === "GET" && url === "/status") {
      if (!this.checkAuth(req, res)) return;
      this.handleStatus(res);
      return;
    }

    // --- POST / (existing action-based RPC) ---

    if (method !== "POST" || url !== "/") {
      this.sendResponse(res, 404, { success: false, error: "Not found" });
      return;
    }

    if (!this.checkAuth(req, res)) return;

    // Reject new work during shutdown
    if (this.shuttingDown) {
      this.sendResponse(res, 503, { success: false, error: "Server is shutting down" });
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

    // Track in-flight requests for graceful shutdown
    this.activeRequests++;
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
        case "browser.create":
          await this.handleBrowserCreate(res, request.options);
          break;
        case "browser.stop":
          await this.handleBrowserStop(res, request.sessionId);
          break;
        case "browser.list":
          this.handleBrowserList(res);
          break;
        default:
          this.sendResponse(res, 400, { success: false, error: "Unknown action" });
      }
    } catch (error: any) {
      this.sendResponse(res, 500, { success: false, error: error.message });
    } finally {
      this.activeRequests--;
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
      ready: this.client?.isReady() ?? false,
      port: this.options.port,
      poolSize: this.options.poolSize,
      uptime: Date.now() - this.startTime,
      pid: process.pid,
      activeRequests: this.activeRequests,
    };
    this.sendResponse<DaemonStatus>(res, 200, { success: true, data: status });
  }

  /**
   * Handle shutdown request
   */
  private async handleShutdown(res: http.ServerResponse): Promise<void> {
    this.sendResponse(res, 200, { success: true, data: { message: "Shutting down" } });

    // Graceful shutdown: wait for in-flight requests, then stop
    setTimeout(() => {
      this.gracefulStop().then(() => process.exit(0));
    }, 100);
  }

  /**
   * Graceful shutdown: stop accepting new requests, drain in-flight, then close.
   */
  async gracefulStop(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    logger.info("Graceful shutdown initiated...");

    // 1. Stop accepting new connections
    if (this.server) {
      this.server.close();
    }

    // 2. Wait for in-flight requests to complete (with timeout)
    const drainStart = Date.now();
    while (this.activeRequests > 0 && Date.now() - drainStart < SHUTDOWN_TIMEOUT_MS) {
      if (this.options.verbose) {
        logger.info(`Waiting for ${this.activeRequests} in-flight request(s) to complete...`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (this.activeRequests > 0) {
      logger.warn(
        `Shutdown timeout reached with ${this.activeRequests} requests still in-flight — forcing close`
      );
    }

    // 3. Close all browser sessions
    for (const session of this.browserSessions.values()) {
      await session.close().catch(() => {});
    }
    this.browserSessions.clear();

    // 4. Close client and pool
    await this.stop();

    logger.info("Graceful shutdown complete");
  }

  /**
   * Handle browser.create request
   */
  private async handleBrowserCreate(
    res: http.ServerResponse,
    options: Omit<BrowserOptions, "connectionToCore">
  ): Promise<void> {
    if (!this.client) {
      this.sendResponse(res, 500, { success: false, error: "Client not initialized" });
      return;
    }

    const session = await this.client.browser(options);
    this.browserSessions.set(session.sessionId, session);

    // Return serializable info (no close function)
    const info: BrowserSessionInfo = {
      sessionId: session.sessionId,
      wsEndpoint: session.wsEndpoint,
      createdAt: session.createdAt,
    };
    this.sendResponse<BrowserSessionInfo>(res, 200, { success: true, data: info });
  }

  /**
   * Handle browser.stop request
   */
  private async handleBrowserStop(res: http.ServerResponse, sessionId: string): Promise<void> {
    const session = this.browserSessions.get(sessionId);
    if (!session) {
      this.sendResponse(res, 404, { success: false, error: `Session ${sessionId} not found` });
      return;
    }

    await session.close();
    this.browserSessions.delete(sessionId);
    this.sendResponse(res, 200, { success: true, data: { sessionId } });
  }

  /**
   * Handle browser.list request
   */
  private handleBrowserList(res: http.ServerResponse): void {
    const sessions: BrowserSessionInfo[] = Array.from(this.browserSessions.values()).map((s) => ({
      sessionId: s.sessionId,
      wsEndpoint: s.wsEndpoint,
      createdAt: s.createdAt,
    }));
    this.sendResponse<BrowserSessionInfo[]>(res, 200, { success: true, data: sessions });
  }

  /**
   * Send JSON response
   */
  private sendResponse<T>(
    res: http.ServerResponse,
    statusCode: number,
    data: DaemonResponse<T>
  ): void {
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
export async function getDaemonInfo(): Promise<{
  pid: number;
  port: number;
  startedAt: string;
} | null> {
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
