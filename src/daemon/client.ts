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
 *
 * // Session-based interaction
 * const { sessionId } = await client.sessionCreate();
 * await client.sessionGoto(sessionId, 'https://example.com');
 * const { snapshot } = await client.sessionSnapshot(sessionId, { interactive: true });
 * await client.sessionClick(sessionId, '@e3');
 * await client.sessionClose(sessionId);
 */

import http from "http";
import type { ScrapeOptions, ScrapeResult } from "../types";
import type { CrawlOptions, CrawlResult } from "../crawl-types";
import type { DaemonStatus } from "./server";
import { DEFAULT_DAEMON_PORT } from "./server";
import type {
  SessionCreateOptions,
  SnapshotOptions,
  ScreenshotOptions,
  NavigationResult,
  ConsoleEntry,
  NetworkEntry,
  DialogEntry,
  CookieEntry,
} from "../browser/types";
import type { SessionInfo } from "./types";

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

  // ===========================================================================
  // Session methods
  // ===========================================================================

  async sessionCreate(options?: SessionCreateOptions): Promise<{ sessionId: string }> {
    return this.request<{ sessionId: string }>({
      action: "session.create",
      options,
    });
  }

  async sessionClose(sessionId: string): Promise<void> {
    await this.request<{ closed: boolean }>({
      action: "session.close",
      sessionId,
    });
  }

  async sessionList(): Promise<SessionInfo[]> {
    return this.request<SessionInfo[]>({
      action: "session.list",
    });
  }

  async sessionGoto(
    sessionId: string,
    url: string,
    timeoutMs?: number
  ): Promise<NavigationResult> {
    return this.request<NavigationResult>({
      action: "session.goto",
      sessionId,
      url,
      timeoutMs,
    });
  }

  async sessionBack(sessionId: string): Promise<{ url: string }> {
    return this.request<{ url: string }>({
      action: "session.back",
      sessionId,
    });
  }

  async sessionForward(sessionId: string): Promise<{ url: string }> {
    return this.request<{ url: string }>({
      action: "session.forward",
      sessionId,
    });
  }

  async sessionReload(sessionId: string): Promise<void> {
    await this.request<{ reloaded: boolean }>({
      action: "session.reload",
      sessionId,
    });
  }

  async sessionUrl(sessionId: string): Promise<{ url: string }> {
    return this.request<{ url: string }>({
      action: "session.url",
      sessionId,
    });
  }

  async sessionSnapshot(
    sessionId: string,
    options?: SnapshotOptions
  ): Promise<{ snapshot: string }> {
    return this.request<{ snapshot: string }>({
      action: "session.snapshot",
      sessionId,
      options,
    });
  }

  async sessionClick(sessionId: string, selectorOrRef: string): Promise<void> {
    await this.request<{ clicked: boolean }>({
      action: "session.click",
      sessionId,
      selectorOrRef,
    });
  }

  async sessionFill(
    sessionId: string,
    selectorOrRef: string,
    value: string
  ): Promise<void> {
    await this.request<{ filled: boolean }>({
      action: "session.fill",
      sessionId,
      selectorOrRef,
      value,
    });
  }

  async sessionType(sessionId: string, text: string): Promise<void> {
    await this.request<{ typed: boolean }>({
      action: "session.type",
      sessionId,
      text,
    });
  }

  async sessionPress(sessionId: string, key: string): Promise<void> {
    await this.request<{ pressed: boolean }>({
      action: "session.press",
      sessionId,
      key,
    });
  }

  async sessionHover(sessionId: string, selectorOrRef: string): Promise<void> {
    await this.request<{ hovered: boolean }>({
      action: "session.hover",
      sessionId,
      selectorOrRef,
    });
  }

  async sessionSelect(
    sessionId: string,
    selectorOrRef: string,
    value: string
  ): Promise<void> {
    await this.request<{ selected: boolean }>({
      action: "session.select",
      sessionId,
      selectorOrRef,
      value,
    });
  }

  async sessionScroll(sessionId: string, selectorOrRef?: string): Promise<void> {
    await this.request<{ scrolled: boolean }>({
      action: "session.scroll",
      sessionId,
      selectorOrRef,
    });
  }

  async sessionUpload(
    sessionId: string,
    selectorOrRef: string,
    filePaths: string[]
  ): Promise<void> {
    await this.request<{ uploaded: boolean }>({
      action: "session.upload",
      sessionId,
      selectorOrRef,
      filePaths,
    });
  }

  async sessionScreenshot(
    sessionId: string,
    options?: ScreenshotOptions
  ): Promise<{ screenshot: string; format: string }> {
    return this.request<{ screenshot: string; format: string }>({
      action: "session.screenshot",
      sessionId,
      options,
    });
  }

  async sessionResponsive(
    sessionId: string,
    outputPrefix: string
  ): Promise<{ paths: string[] }> {
    return this.request<{ paths: string[] }>({
      action: "session.responsive",
      sessionId,
      outputPrefix,
    });
  }

  async sessionHtml(sessionId: string, selector?: string): Promise<{ html: string }> {
    return this.request<{ html: string }>({
      action: "session.html",
      sessionId,
      selector,
    });
  }

  async sessionMarkdown(sessionId: string): Promise<{ markdown: string }> {
    return this.request<{ markdown: string }>({
      action: "session.markdown",
      sessionId,
    });
  }

  async sessionText(sessionId: string): Promise<{ text: string }> {
    return this.request<{ text: string }>({
      action: "session.text",
      sessionId,
    });
  }

  async sessionLinks(
    sessionId: string
  ): Promise<{ links: Array<{ text: string; href: string }> }> {
    return this.request<{ links: Array<{ text: string; href: string }> }>({
      action: "session.links",
      sessionId,
    });
  }

  async sessionIs(
    sessionId: string,
    check: "visible" | "enabled" | "checked",
    selectorOrRef: string
  ): Promise<{ result: boolean }> {
    return this.request<{ result: boolean }>({
      action: "session.is",
      sessionId,
      check,
      selectorOrRef,
    });
  }

  async sessionConsole(
    sessionId: string,
    opts?: { errors?: boolean; clear?: boolean }
  ): Promise<{ entries: ConsoleEntry[] }> {
    return this.request<{ entries: ConsoleEntry[] }>({
      action: "session.console",
      sessionId,
      errors: opts?.errors,
      clear: opts?.clear,
    });
  }

  async sessionNetwork(
    sessionId: string,
    opts?: { errors?: boolean; clear?: boolean }
  ): Promise<{ entries: NetworkEntry[] }> {
    return this.request<{ entries: NetworkEntry[] }>({
      action: "session.network",
      sessionId,
      errors: opts?.errors,
      clear: opts?.clear,
    });
  }

  async sessionDialog(
    sessionId: string,
    opts?: { clear?: boolean }
  ): Promise<{ entries: DialogEntry[] }> {
    return this.request<{ entries: DialogEntry[] }>({
      action: "session.dialog",
      sessionId,
      clear: opts?.clear,
    });
  }

  async sessionDialogMode(
    sessionId: string,
    mode: "accept" | "dismiss",
    promptText?: string
  ): Promise<void> {
    await this.request<{ mode: string }>({
      action: "session.dialog-mode",
      sessionId,
      mode,
      promptText,
    });
  }

  async sessionCookies(
    sessionId: string
  ): Promise<{ cookies: CookieEntry[] }> {
    return this.request<{ cookies: CookieEntry[] }>({
      action: "session.cookies",
      sessionId,
    });
  }

  async sessionJs(
    sessionId: string,
    expression: string
  ): Promise<{ result: string }> {
    return this.request<{ result: string }>({
      action: "session.js",
      sessionId,
      expression,
    });
  }

  async sessionViewport(
    sessionId: string,
    width: number,
    height: number
  ): Promise<void> {
    await this.request<{ width: number; height: number }>({
      action: "session.viewport",
      sessionId,
      width,
      height,
    });
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
