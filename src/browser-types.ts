import type { ProxyConfig, ProxyTier } from "./types";

/**
 * Options for creating a browser session.
 *
 * A browser session launches a Hero-stealthed Chrome instance and returns
 * a CDP WebSocket URL. Users connect Playwright/Puppeteer via
 * `chromium.connectOverCDP(wsEndpoint)` and get full anti-bot stealth
 * (TLS fingerprinting, navigator/WebGL spoofing, WebRTC masking).
 */
export interface BrowserOptions {
  /** Proxy configuration (single proxy — use proxyTier for pool-based) */
  proxy?: ProxyConfig;

  /** Proxy tier selection (default: "auto") */
  proxyTier?: ProxyTier;

  /** Show Chrome browser window (default: false) */
  showChrome?: boolean;

  /**
   * Maximum session lifetime in milliseconds (default: 300000 = 5 min).
   * Session auto-closes after this duration.
   */
  timeoutMs?: number;

  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

/**
 * An active browser session with a CDP WebSocket endpoint.
 *
 * Connect to `wsEndpoint` using Playwright or Puppeteer:
 *
 * @example
 * ```typescript
 * import { chromium } from 'playwright';
 *
 * const session = await reader.browser({ proxyTier: 'stealth' });
 * const browser = await chromium.connectOverCDP(session.wsEndpoint);
 * const page = browser.contexts()[0].pages()[0];
 *
 * await page.goto('https://example.com');
 * console.log(await page.title());
 *
 * await session.close();
 * ```
 */
export interface BrowserSession {
  /** Unique session identifier */
  sessionId: string;

  /** CDP WebSocket URL for Playwright/Puppeteer connection */
  wsEndpoint: string;

  /** ISO timestamp of session creation */
  createdAt: string;

  /** Close the session and release all resources */
  close: () => Promise<void>;
}

/**
 * Internal options for createBrowserSession (includes injected deps).
 * Not part of the public API.
 */
export interface BrowserSessionInternalOptions extends BrowserOptions {
  /** Connection to shared HeroCore instance */
  connectionToCore?: any;

  /** Proxy resolver callback (provided by ReaderClient) */
  resolveProxy?: (tier: ProxyTier | undefined) => ProxyConfig | undefined;
}
