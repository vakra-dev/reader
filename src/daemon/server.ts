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
import { BrowserSession } from "../browser/session";
import type { SessionRequest, SessionInfo } from "./types";

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

type DaemonRequest = ScrapeRequest | CrawlRequest | StatusRequest | ShutdownRequest | SessionRequest;

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
/** Session idle timeout: 5 minutes */
const SESSION_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const SESSION_CLEANUP_INTERVAL_MS = 30 * 1000;

export class DaemonServer {
  private server: http.Server | null = null;
  private client: ReaderClient | null = null;
  private options: Required<DaemonServerOptions>;
  private startTime: number = 0;
  private sessions: Map<string, BrowserSession> = new Map();
  private sessionCleanupTimer?: NodeJS.Timeout;

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

    // Start session idle cleanup
    this.startSessionCleanup();

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

    // Stop session cleanup
    if (this.sessionCleanupTimer) {
      clearInterval(this.sessionCleanupTimer);
    }

    // Close all sessions
    for (const session of this.sessions.values()) {
      await session.close().catch(() => {});
    }
    this.sessions.clear();

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
          // Check if it's a session action
          if (request.action.startsWith("session.")) {
            await this.handleSessionAction(res, request as SessionRequest);
            break;
          }
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

  // ===========================================================================
  // Session management
  // ===========================================================================

  private getSession(sessionId: string): BrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    if (session.isClosed()) {
      this.sessions.delete(sessionId);
      throw new Error(`Session ${sessionId} is closed`);
    }
    return session;
  }

  private async handleSessionAction(
    res: http.ServerResponse,
    request: SessionRequest
  ): Promise<void> {
    if (!this.client) {
      this.sendResponse(res, 500, { success: false, error: "Client not initialized" });
      return;
    }

    switch (request.action) {
      case "session.create": {
        const pool = this.client.getPool();
        if (!pool) {
          this.sendResponse(res, 500, { success: false, error: "Browser pool not available" });
          return;
        }
        const session = await BrowserSession.create(pool, request.options);
        this.sessions.set(session.id, session);
        if (this.options.verbose) {
          logger.info(`Session created: ${session.id} (active: ${this.sessions.size})`);
        }
        this.sendResponse(res, 200, { success: true, data: { sessionId: session.id } });
        break;
      }

      case "session.close": {
        const session = this.getSession(request.sessionId);
        await session.close();
        this.sessions.delete(request.sessionId);
        if (this.options.verbose) {
          logger.info(`Session closed: ${request.sessionId} (active: ${this.sessions.size})`);
        }
        this.sendResponse(res, 200, { success: true, data: { closed: true } });
        break;
      }

      case "session.list": {
        const sessions: SessionInfo[] = [];
        for (const [id, session] of this.sessions) {
          sessions.push({
            id,
            createdAt: 0,
            lastActivity: session.getLastActivity(),
            closed: session.isClosed(),
          });
        }
        this.sendResponse(res, 200, { success: true, data: sessions });
        break;
      }

      case "session.goto": {
        const session = this.getSession(request.sessionId);
        const result = await session.goto(request.url, { timeoutMs: request.timeoutMs });
        this.sendResponse(res, 200, { success: true, data: result });
        break;
      }

      case "session.back": {
        const session = this.getSession(request.sessionId);
        const url = await session.goBack();
        this.sendResponse(res, 200, { success: true, data: { url } });
        break;
      }

      case "session.forward": {
        const session = this.getSession(request.sessionId);
        const url = await session.goForward();
        this.sendResponse(res, 200, { success: true, data: { url } });
        break;
      }

      case "session.reload": {
        const session = this.getSession(request.sessionId);
        await session.reload();
        this.sendResponse(res, 200, { success: true, data: { reloaded: true } });
        break;
      }

      case "session.url": {
        const session = this.getSession(request.sessionId);
        const url = await session.getUrl();
        this.sendResponse(res, 200, { success: true, data: { url } });
        break;
      }

      case "session.snapshot": {
        const session = this.getSession(request.sessionId);
        const snapshot = await session.snapshot(request.options);
        this.sendResponse(res, 200, { success: true, data: { snapshot } });
        break;
      }

      case "session.click": {
        const session = this.getSession(request.sessionId);
        await session.click(request.selectorOrRef);
        this.sendResponse(res, 200, { success: true, data: { clicked: true } });
        break;
      }

      case "session.fill": {
        const session = this.getSession(request.sessionId);
        await session.fill(request.selectorOrRef, request.value);
        this.sendResponse(res, 200, { success: true, data: { filled: true } });
        break;
      }

      case "session.type": {
        const session = this.getSession(request.sessionId);
        await session.type(request.text);
        this.sendResponse(res, 200, { success: true, data: { typed: true } });
        break;
      }

      case "session.press": {
        const session = this.getSession(request.sessionId);
        await session.press(request.key);
        this.sendResponse(res, 200, { success: true, data: { pressed: true } });
        break;
      }

      case "session.hover": {
        const session = this.getSession(request.sessionId);
        await session.hover(request.selectorOrRef);
        this.sendResponse(res, 200, { success: true, data: { hovered: true } });
        break;
      }

      case "session.select": {
        const session = this.getSession(request.sessionId);
        await session.select(request.selectorOrRef, request.value);
        this.sendResponse(res, 200, { success: true, data: { selected: true } });
        break;
      }

      case "session.scroll": {
        const session = this.getSession(request.sessionId);
        await session.scrollTo(request.selectorOrRef);
        this.sendResponse(res, 200, { success: true, data: { scrolled: true } });
        break;
      }

      case "session.upload": {
        const session = this.getSession(request.sessionId);
        await session.upload(request.selectorOrRef, request.filePaths);
        this.sendResponse(res, 200, { success: true, data: { uploaded: true } });
        break;
      }

      case "session.screenshot": {
        const session = this.getSession(request.sessionId);
        const buffer = await session.screenshot(request.options);
        // Return base64 encoded
        this.sendResponse(res, 200, {
          success: true,
          data: { screenshot: buffer.toString("base64"), format: request.options?.format ?? "png" },
        });
        break;
      }

      case "session.responsive": {
        const session = this.getSession(request.sessionId);
        const paths = await session.responsiveScreenshots(request.outputPrefix);
        this.sendResponse(res, 200, { success: true, data: { paths } });
        break;
      }

      case "session.html": {
        const session = this.getSession(request.sessionId);
        const html = await session.getHtml(request.selector);
        this.sendResponse(res, 200, { success: true, data: { html } });
        break;
      }

      case "session.markdown": {
        const session = this.getSession(request.sessionId);
        const markdown = await session.getMarkdown();
        this.sendResponse(res, 200, { success: true, data: { markdown } });
        break;
      }

      case "session.text": {
        const session = this.getSession(request.sessionId);
        const text = await session.getText();
        this.sendResponse(res, 200, { success: true, data: { text } });
        break;
      }

      case "session.links": {
        const session = this.getSession(request.sessionId);
        const links = await session.getLinks();
        this.sendResponse(res, 200, { success: true, data: { links } });
        break;
      }

      case "session.is": {
        const session = this.getSession(request.sessionId);
        let result: boolean;
        switch (request.check) {
          case "visible":
            result = await session.isVisible(request.selectorOrRef);
            break;
          case "enabled":
            result = await session.isEnabled(request.selectorOrRef);
            break;
          case "checked":
            result = await session.isChecked(request.selectorOrRef);
            break;
          default:
            throw new Error(`Unknown check: ${request.check}`);
        }
        this.sendResponse(res, 200, { success: true, data: { result } });
        break;
      }

      case "session.console": {
        const session = this.getSession(request.sessionId);
        const entries = await session.getConsoleMessages({
          errors: request.errors,
          clear: request.clear,
        });
        this.sendResponse(res, 200, { success: true, data: { entries } });
        break;
      }

      case "session.network": {
        const session = this.getSession(request.sessionId);
        const entries = session.getNetworkRequests({
          errors: request.errors,
          clear: request.clear,
        });
        this.sendResponse(res, 200, { success: true, data: { entries } });
        break;
      }

      case "session.dialog": {
        const session = this.getSession(request.sessionId);
        const entries = session.getDialogs({ clear: request.clear });
        this.sendResponse(res, 200, { success: true, data: { entries } });
        break;
      }

      case "session.dialog-mode": {
        const session = this.getSession(request.sessionId);
        session.setDialogMode(request.mode, request.promptText);
        this.sendResponse(res, 200, { success: true, data: { mode: request.mode } });
        break;
      }

      case "session.cookies": {
        const session = this.getSession(request.sessionId);
        const cookies = await session.getCookies();
        this.sendResponse(res, 200, { success: true, data: { cookies } });
        break;
      }

      case "session.js": {
        const session = this.getSession(request.sessionId);
        const result = await session.evaluate(request.expression);
        this.sendResponse(res, 200, { success: true, data: { result } });
        break;
      }

      case "session.viewport": {
        const session = this.getSession(request.sessionId);
        await session.setViewport(request.width, request.height);
        this.sendResponse(res, 200, {
          success: true,
          data: { width: request.width, height: request.height },
        });
        break;
      }

      case "session.query": {
        const session = this.getSession(request.sessionId);
        const element = await session.querySelector(request.selector);
        this.sendResponse(res, 200, { success: true, data: { element } });
        break;
      }

      default:
        this.sendResponse(res, 400, {
          success: false,
          error: `Unknown session action: ${(request as any).action}`,
        });
    }
  }

  /**
   * Start periodic cleanup of idle sessions
   */
  private startSessionCleanup(): void {
    this.sessionCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, session] of this.sessions) {
        if (session.isClosed()) {
          this.sessions.delete(id);
          continue;
        }
        const idle = now - session.getLastActivity();
        if (idle > SESSION_IDLE_TIMEOUT_MS) {
          if (this.options.verbose) {
            logger.info(`Session ${id} idle for ${Math.round(idle / 1000)}s, closing`);
          }
          session.close().catch(() => {});
          this.sessions.delete(id);
        }
      }
    }, SESSION_CLEANUP_INTERVAL_MS);
    this.sessionCleanupTimer.unref();
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
