/**
 * Browser Session
 *
 * A persistent interactive browser session that holds a Hero instance
 * from the pool. Unlike withBrowser() which acquires and releases per
 * callback, sessions persist across multiple CLI invocations via the daemon.
 *
 * @example
 * const session = await BrowserSession.create(pool);
 * await session.goto('https://example.com');
 * const snapshot = await session.snapshot({ interactive: true });
 * await session.click('@e3');
 * await session.screenshot({ path: '/tmp/page.png', annotate: true });
 * await session.close();
 */

import type Hero from "@ulixee/hero";
import type {
  IBrowserPool,
  SessionCreateOptions,
  NavigationResult,
  ElementInfo,
  ConsoleEntry,
  NetworkEntry,
  DialogEntry,
  CookieEntry,
  SnapshotOptions,
  ScreenshotOptions,
} from "./types.js";
import { RefManager, QUERY_INTERACTIVE_ELEMENTS_JS, QUERY_ALL_ELEMENTS_JS } from "./refs.js";
import {
  buildInteractiveSnapshot,
  buildFullSnapshot,
  computeSnapshotDiff,
  type RawElement,
} from "./snapshot.js";
import { htmlToMarkdown } from "../formatters/markdown.js";
import { cleanContent } from "../utils/content-cleaner.js";

// Console capture injection script
const CONSOLE_CAPTURE_JS = `
(function() {
  if (window.__readerConsoleBuffer) return;
  window.__readerConsoleBuffer = [];
  const maxSize = 10000;
  const original = {};
  ['log', 'warn', 'error', 'info', 'debug'].forEach(level => {
    original[level] = console[level];
    console[level] = function(...args) {
      if (window.__readerConsoleBuffer.length < maxSize) {
        window.__readerConsoleBuffer.push({
          level: level,
          text: args.map(a => {
            try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
            catch { return String(a); }
          }).join(' '),
          timestamp: new Date().toISOString(),
        });
      }
      original[level].apply(console, args);
    };
  });

  // Capture unhandled errors
  window.addEventListener('error', function(e) {
    if (window.__readerConsoleBuffer.length < maxSize) {
      window.__readerConsoleBuffer.push({
        level: 'error',
        text: e.message + (e.filename ? ' at ' + e.filename + ':' + e.lineno : ''),
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', function(e) {
    if (window.__readerConsoleBuffer.length < maxSize) {
      window.__readerConsoleBuffer.push({
        level: 'error',
        text: 'Unhandled rejection: ' + (e.reason?.message || String(e.reason)),
        timestamp: new Date().toISOString(),
      });
    }
  });
})()
`;

// Annotated screenshot overlay injection
const ANNOTATE_OVERLAY_JS = `
(function(refs) {
  // Remove previous annotations
  const prev = document.getElementById('__reader_annotations');
  if (prev) prev.remove();

  const container = document.createElement('div');
  container.id = '__reader_annotations';
  container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;';

  for (const ref of refs) {
    if (!ref.boundingBox) continue;
    const { x, y, width, height } = ref.boundingBox;

    // Red outline box
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;border:2px solid #ff0000;pointer-events:none;' +
      'left:' + x + 'px;top:' + y + 'px;width:' + width + 'px;height:' + height + 'px;';

    // Label
    const label = document.createElement('div');
    label.textContent = ref.ref;
    label.style.cssText = 'position:fixed;background:#ff0000;color:#fff;font-size:10px;' +
      'font-family:monospace;padding:1px 3px;pointer-events:none;line-height:1.2;' +
      'left:' + x + 'px;top:' + Math.max(0, y - 14) + 'px;';

    container.appendChild(box);
    container.appendChild(label);
  }

  document.body.appendChild(container);
})
`;

// Remove annotation overlay
const REMOVE_OVERLAY_JS = `
(function() {
  const el = document.getElementById('__reader_annotations');
  if (el) el.remove();
})()
`;

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Interactive browser session with ref system
 */
export class BrowserSession {
  readonly id: string;
  private hero: Hero;
  private pool: IBrowserPool;
  private refs: RefManager;
  private lastSnapshotText: string | null = null;
  private networkBuffer: NetworkEntry[] = [];
  private dialogBuffer: DialogEntry[] = [];
  private dialogAutoAccept = true;
  private dialogPromptText?: string;
  private closed = false;
  private currentUrl = "";
  private lastActivity: number;
  private viewportWidth: number;
  private viewportHeight: number;

  private constructor(
    hero: Hero,
    pool: IBrowserPool,
    options?: SessionCreateOptions
  ) {
    this.id = generateSessionId();
    this.hero = hero;
    this.pool = pool;
    this.refs = new RefManager();
    this.lastActivity = Date.now();
    this.viewportWidth = options?.viewportWidth ?? 1920;
    this.viewportHeight = options?.viewportHeight ?? 1080;
  }

  /**
   * Create a new browser session by acquiring a Hero instance from the pool
   */
  static async create(
    pool: IBrowserPool,
    options?: SessionCreateOptions
  ): Promise<BrowserSession> {
    const hero = await pool.acquire();
    const session = new BrowserSession(hero, pool, options);
    await session.setupEventListeners();
    return session;
  }

  /**
   * Close the session and release the browser back to the pool
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.pool.release(this.hero);
  }

  // ===========================================================================
  // Navigation
  // ===========================================================================

  async goto(
    url: string,
    opts?: { timeoutMs?: number }
  ): Promise<NavigationResult> {
    this.ensureOpen();
    this.touch();
    this.refs.clear();
    this.lastSnapshotText = null;

    await this.hero.goto(url, { timeoutMs: opts?.timeoutMs ?? 30000 });

    try {
      await this.hero.waitForLoad("DomContentLoaded", {
        timeoutMs: opts?.timeoutMs ?? 30000,
      });
    } catch {
      // Timeout OK, continue
    }
    await this.hero.waitForPaintingStable();

    // Inject console capture
    await this.injectConsoleCapture();

    this.currentUrl = await this.hero.url;
    const title = await this.hero.document.title;

    return { url: this.currentUrl, title };
  }

  async goBack(): Promise<string> {
    this.ensureOpen();
    this.touch();
    this.refs.clear();
    this.lastSnapshotText = null;
    await this.hero.goBack();
    await this.hero.waitForPaintingStable();
    await this.injectConsoleCapture();
    this.currentUrl = await this.hero.url;
    return this.currentUrl;
  }

  async goForward(): Promise<string> {
    this.ensureOpen();
    this.touch();
    this.refs.clear();
    this.lastSnapshotText = null;
    await this.hero.goForward();
    await this.hero.waitForPaintingStable();
    await this.injectConsoleCapture();
    this.currentUrl = await this.hero.url;
    return this.currentUrl;
  }

  async reload(): Promise<void> {
    this.ensureOpen();
    this.touch();
    this.refs.clear();
    this.lastSnapshotText = null;
    await this.hero.reload();
    await this.hero.waitForPaintingStable();
    await this.injectConsoleCapture();
    this.currentUrl = await this.hero.url;
  }

  async getUrl(): Promise<string> {
    this.ensureOpen();
    this.currentUrl = await this.hero.url;
    return this.currentUrl;
  }

  async getTitle(): Promise<string> {
    this.ensureOpen();
    return await this.hero.document.title;
  }

  // ===========================================================================
  // Snapshot + Refs
  // ===========================================================================

  async snapshot(options?: SnapshotOptions): Promise<string> {
    this.ensureOpen();
    this.touch();

    let text: string;

    if (options?.interactive !== false) {
      // Default: query interactive elements and assign refs
      // Query interactive elements
      const rawJson = await this.hero.getJsValue<string>(
        QUERY_INTERACTIVE_ELEMENTS_JS
      );
      const rawElements = JSON.parse(rawJson) as Array<{
        tag: string;
        role: string;
        text: string;
        selector: string;
        xpath: string;
        visible: boolean;
        attributes: Record<string, string>;
        boundingBox?: { x: number; y: number; width: number; height: number };
      }>;

      // Assign refs
      const refs = this.refs.assign(rawElements);
      text = buildInteractiveSnapshot(refs);
    } else {
      // Full tree snapshot
      const rawJson = await this.hero.getJsValue<string>(
        QUERY_ALL_ELEMENTS_JS
      );
      const rawElements = JSON.parse(rawJson) as RawElement[];

      // Also query interactive for refs
      const interactiveJson = await this.hero.getJsValue<string>(
        QUERY_INTERACTIVE_ELEMENTS_JS
      );
      const interactiveElements = JSON.parse(interactiveJson);
      const refs = this.refs.assign(interactiveElements);

      text = buildFullSnapshot(rawElements, refs, options);
    }

    // Handle diff
    if (options?.diff && this.lastSnapshotText) {
      const diff = computeSnapshotDiff(this.lastSnapshotText, text);
      this.lastSnapshotText = text;
      return diff;
    }

    this.lastSnapshotText = text;
    return text;
  }

  // ===========================================================================
  // Interaction
  // ===========================================================================

  async click(selectorOrRef: string): Promise<void> {
    this.ensureOpen();
    this.touch();
    const { selector } = this.refs.resolve(selectorOrRef);
    const element = this.hero.document.querySelector(selector);
    await this.hero.click(element);
    await this.hero.waitForPaintingStable();
  }

  async fill(selectorOrRef: string, value: string): Promise<void> {
    this.ensureOpen();
    this.touch();
    const { selector } = this.refs.resolve(selectorOrRef);
    const element = this.hero.document.querySelector(selector);

    // Focus, clear, and type
    await this.hero.click(element);
    // Select all existing text and replace
    await this.hero.interact(
      { keyPress: "KeyA" as any },
    );
    await this.hero.type(value);
  }

  async type(text: string): Promise<void> {
    this.ensureOpen();
    this.touch();
    await this.hero.type(text);
  }

  async press(key: string): Promise<void> {
    this.ensureOpen();
    this.touch();
    await this.hero.interact({ keyPress: key as any });
  }

  async hover(selectorOrRef: string): Promise<void> {
    this.ensureOpen();
    this.touch();
    const { selector } = this.refs.resolve(selectorOrRef);
    const element = this.hero.document.querySelector(selector);
    await this.hero.interact({ move: element });
  }

  async select(selectorOrRef: string, value: string): Promise<void> {
    this.ensureOpen();
    this.touch();
    const { selector } = this.refs.resolve(selectorOrRef);
    // Use JS to set value on select element
    await this.hero.getJsValue<void>(
      `(function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) {
          el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()`
    );
  }

  async scrollTo(selectorOrRef?: string): Promise<void> {
    this.ensureOpen();
    this.touch();
    if (selectorOrRef) {
      const { selector } = this.refs.resolve(selectorOrRef);
      const element = this.hero.document.querySelector(selector);
      await this.hero.scrollTo(element);
    } else {
      // Scroll to bottom
      await this.hero.getJsValue<void>(
        `window.scrollTo(0, document.body.scrollHeight)`
      );
    }
  }

  async upload(selectorOrRef: string, filePaths: string[]): Promise<void> {
    this.ensureOpen();
    this.touch();
    const { selector } = this.refs.resolve(selectorOrRef);
    const element = this.hero.document.querySelector(selector);

    // Click to trigger file chooser, then handle it
    const fs = await import("fs/promises");
    const path = await import("path");

    const fileChooserPromise = this.hero.waitForFileChooser();
    await this.hero.click(element);
    const fileChooser = await fileChooserPromise;

    const files = await Promise.all(
      filePaths.map(async (fp) => ({
        name: path.basename(fp),
        data: await fs.readFile(fp),
      }))
    );

    await fileChooser.chooseFiles(...files);
  }

  // ===========================================================================
  // Observation
  // ===========================================================================

  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    this.ensureOpen();
    this.touch();

    // If annotate, inject overlay first
    if (options?.annotate) {
      const refs = this.refs.getAll();
      if (refs.length > 0) {
        // Refresh bounding boxes
        const rawJson = await this.hero.getJsValue<string>(
          QUERY_INTERACTIVE_ELEMENTS_JS
        );
        const rawElements = JSON.parse(rawJson);
        const freshRefs = this.refs.assign(rawElements);

        await this.hero.getJsValue<void>(
          `(${ANNOTATE_OVERLAY_JS})(${JSON.stringify(freshRefs)})`
        );
      }
    }

    const buffer = await this.hero.takeScreenshot({
      format: options?.format ?? "png",
      fullPage: options?.fullPage ?? false,
    });

    // Remove overlay after screenshot
    if (options?.annotate) {
      await this.hero.getJsValue<void>(REMOVE_OVERLAY_JS);
    }

    // Save to file if path specified
    if (options?.path) {
      const fs = await import("fs/promises");
      const pathModule = await import("path");
      // Ensure directory exists
      await fs.mkdir(pathModule.dirname(options.path), { recursive: true });
      await fs.writeFile(options.path, buffer);
    }

    return buffer;
  }

  async responsiveScreenshots(
    outputPrefix: string
  ): Promise<string[]> {
    this.ensureOpen();
    this.touch();

    const viewports = [
      { name: "mobile", width: 375, height: 812 },
      { name: "tablet", width: 768, height: 1024 },
      { name: "desktop", width: 1280, height: 720 },
    ];

    const paths: string[] = [];

    for (const vp of viewports) {
      // Simulate viewport width using CSS injection
      await this.hero.getJsValue<void>(
        `(function() {
          document.documentElement.style.width = '${vp.width}px';
          document.documentElement.style.maxWidth = '${vp.width}px';
          document.documentElement.style.overflow = 'hidden';
          document.body.style.width = '${vp.width}px';
          document.body.style.maxWidth = '${vp.width}px';
        })()`
      );

      // Wait for reflow
      await this.hero.waitForPaintingStable();
      await new Promise((r) => setTimeout(r, 500));

      const filePath = `${outputPrefix}-${vp.name}.png`;
      await this.screenshot({ path: filePath });
      paths.push(filePath);
    }

    // Reset styles
    await this.hero.getJsValue<void>(
      `(function() {
        document.documentElement.style.width = '';
        document.documentElement.style.maxWidth = '';
        document.documentElement.style.overflow = '';
        document.body.style.width = '';
        document.body.style.maxWidth = '';
      })()`
    );

    return paths;
  }

  async getHtml(selector?: string): Promise<string> {
    this.ensureOpen();
    this.touch();
    if (selector) {
      return await this.hero.getJsValue<string>(
        `document.querySelector(${JSON.stringify(selector)})?.innerHTML || ''`
      );
    }
    return await this.hero.document.documentElement.outerHTML;
  }

  async getMarkdown(): Promise<string> {
    this.ensureOpen();
    this.touch();
    const html = await this.hero.document.documentElement.outerHTML;
    const url = await this.hero.url;
    const cleaned = cleanContent(html, url, { onlyMainContent: true });
    return htmlToMarkdown(cleaned);
  }

  async getText(): Promise<string> {
    this.ensureOpen();
    this.touch();
    return await this.hero.getJsValue<string>(
      `document.body.innerText`
    );
  }

  async getLinks(): Promise<Array<{ text: string; href: string }>> {
    this.ensureOpen();
    this.touch();
    const json = await this.hero.getJsValue<string>(
      `JSON.stringify(Array.from(document.querySelectorAll('a[href]')).map(a => ({
        text: (a.textContent || '').trim().substring(0, 80),
        href: a.href,
      })))`
    );
    return JSON.parse(json);
  }

  async querySelector(selector: string): Promise<ElementInfo | null> {
    this.ensureOpen();
    this.touch();
    const json = await this.hero.getJsValue<string>(
      `(function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return 'null';
        const role = el.getAttribute('role') || el.tagName.toLowerCase();
        const rect = el.getBoundingClientRect();
        return JSON.stringify({
          tag: el.tagName.toLowerCase(),
          role: role,
          text: (el.textContent || '').trim().substring(0, 80),
          visible: rect.width > 0 && rect.height > 0,
          attributes: {},
        });
      })()`
    );
    const parsed = JSON.parse(json);
    return parsed === null ? null : parsed;
  }

  async querySelectorAll(
    selector: string
  ): Promise<ElementInfo[]> {
    this.ensureOpen();
    this.touch();
    const json = await this.hero.getJsValue<string>(
      `JSON.stringify(Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map(el => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().substring(0, 80),
          visible: rect.width > 0 && rect.height > 0,
          attributes: {},
        };
      }))`
    );
    return JSON.parse(json);
  }

  // ===========================================================================
  // State checks
  // ===========================================================================

  async isVisible(selectorOrRef: string): Promise<boolean> {
    this.ensureOpen();
    const { selector } = this.refs.resolve(selectorOrRef);
    return await this.hero.getJsValue<boolean>(
      `(function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })()`
    );
  }

  async isEnabled(selectorOrRef: string): Promise<boolean> {
    this.ensureOpen();
    const { selector } = this.refs.resolve(selectorOrRef);
    return await this.hero.getJsValue<boolean>(
      `(function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        return el ? !el.disabled : false;
      })()`
    );
  }

  async isChecked(selectorOrRef: string): Promise<boolean> {
    this.ensureOpen();
    const { selector } = this.refs.resolve(selectorOrRef);
    return await this.hero.getJsValue<boolean>(
      `(function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        return el ? !!el.checked : false;
      })()`
    );
  }

  // ===========================================================================
  // Inspection buffers
  // ===========================================================================

  async getConsoleMessages(
    opts?: { errors?: boolean; clear?: boolean }
  ): Promise<ConsoleEntry[]> {
    this.ensureOpen();

    // Fetch from injected buffer
    const json = await this.hero.getJsValue<string>(
      `JSON.stringify(window.__readerConsoleBuffer || [])`
    );
    let entries: ConsoleEntry[] = JSON.parse(json).map(
      (e: { level: string; text: string; timestamp: string }) => ({
        level: e.level as ConsoleEntry["level"],
        text: e.text,
        url: this.currentUrl,
        timestamp: new Date(e.timestamp),
      })
    );

    if (opts?.errors) {
      entries = entries.filter(
        (e) => e.level === "error" || e.level === "warn"
      );
    }

    if (opts?.clear) {
      await this.hero.getJsValue<void>(
        `window.__readerConsoleBuffer = []`
      );
    }

    return entries;
  }

  getNetworkRequests(
    opts?: { errors?: boolean; clear?: boolean }
  ): NetworkEntry[] {
    let entries = [...this.networkBuffer];

    if (opts?.errors) {
      entries = entries.filter((e) => e.status >= 400);
    }

    if (opts?.clear) {
      this.networkBuffer = [];
    }

    return entries;
  }

  getDialogs(opts?: { clear?: boolean }): DialogEntry[] {
    const entries = [...this.dialogBuffer];

    if (opts?.clear) {
      this.dialogBuffer = [];
    }

    return entries;
  }

  async evaluate(expression: string): Promise<string> {
    this.ensureOpen();
    this.touch();
    const result = await this.hero.getJsValue<any>(expression);
    if (typeof result === "string") return result;
    if (result === undefined || result === null) return String(result);
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }

  async getCookies(): Promise<CookieEntry[]> {
    this.ensureOpen();
    const json = await this.hero.getJsValue<string>(
      `JSON.stringify(document.cookie.split(';').map(c => {
        const [name, ...rest] = c.trim().split('=');
        return { name: name, value: rest.join('='), domain: location.hostname, path: '/', secure: location.protocol === 'https:', httpOnly: false, sameSite: '' };
      }))`
    );
    return JSON.parse(json);
  }

  // ===========================================================================
  // Viewport
  // ===========================================================================

  async setViewport(width: number, height: number): Promise<void> {
    this.ensureOpen();
    this.touch();
    this.viewportWidth = width;
    this.viewportHeight = height;

    // Hero doesn't support dynamic viewport changes.
    // Simulate by constraining the document width.
    await this.hero.getJsValue<void>(
      `(function() {
        document.documentElement.style.width = '${width}px';
        document.documentElement.style.maxWidth = '${width}px';
        document.body.style.width = '${width}px';
        document.body.style.maxWidth = '${width}px';
      })()`
    );
    await this.hero.waitForPaintingStable();
  }

  getViewport(): { width: number; height: number } {
    return { width: this.viewportWidth, height: this.viewportHeight };
  }

  // ===========================================================================
  // Dialog control
  // ===========================================================================

  setDialogMode(
    mode: "accept" | "dismiss",
    promptText?: string
  ): void {
    this.dialogAutoAccept = mode === "accept";
    this.dialogPromptText = promptText;
  }

  // ===========================================================================
  // Session metadata
  // ===========================================================================

  /**
   * Get the last activity timestamp (for idle timeout)
   */
  getLastActivity(): number {
    return this.lastActivity;
  }

  /**
   * Check if session is closed
   */
  isClosed(): boolean {
    return this.closed;
  }

  // ===========================================================================
  // Private methods
  // ===========================================================================

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error(`Session ${this.id} is closed`);
    }
  }

  private touch(): void {
    this.lastActivity = Date.now();
  }

  private async setupEventListeners(): Promise<void> {
    try {
      // Listen for network resources via Tab
      const tab = this.hero.activeTab;

      tab.on("resource", (resource: any) => {
        if (this.networkBuffer.length < 10000) {
          this.networkBuffer.push({
            url: resource.url || "",
            method: resource.request?.method || "GET",
            status: resource.response?.statusCode || 0,
            type: resource.type || "",
            duration: 0,
            timestamp: new Date(),
          });
        }
      });

      tab.on("dialog", async (dialog: any) => {
        // Store in buffer
        this.dialogBuffer.push({
          type: dialog.type || "alert",
          message: dialog.message || "",
          timestamp: new Date(),
        });

        // Auto-handle
        await dialog.dismiss(
          this.dialogAutoAccept,
          this.dialogPromptText
        );
      });
    } catch {
      // Event listeners may fail if Hero version doesn't support them
    }
  }

  private async injectConsoleCapture(): Promise<void> {
    try {
      await this.hero.getJsValue<void>(CONSOLE_CAPTURE_JS);
    } catch {
      // May fail on about:blank or other special pages
    }
  }
}
