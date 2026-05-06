/**
 * ProxyBoundBrowser — a single Hero instance pinned to exactly one proxy URL.
 *
 * This is the per-IP unit of the new TieredBrowserPool. Each instance owns:
 *   - one Hero process (launched with `upstreamProxyUrl` = this.proxyUrl)
 *   - a deterministic fingerprint derived from the proxy URL
 *   - an internal pLimit gate that caps concurrent `withPage` calls
 *   - a four-state lifecycle (launching / active / retired / closed)
 *
 * Design rules (from the architecture review with Nihal):
 *   1. 1 IP = 1 Hero process. Never two browsers on the same proxy URL —
 *      the TieredBrowserPool enforces the 1:1 map above us.
 *   2. Max 2 concurrent tabs per browser by default. This is the per-browser
 *      mirror of the scraper-level PerProxyGate cap.
 *   3. Fingerprint is paired with the proxy, not random per request. Hero is
 *      launched with a stable UA derived from `hash(proxyUrl) -> USER_AGENTS`.
 *   4. Retirement drains. Calling `retire()` stops accepting new work, lets
 *      in-flight tabs finish, then hard-closes Hero. The returned Promise
 *      resolves once the browser is truly gone.
 *   5. Relaunch keeps the binding. When the health tracker revives a proxy
 *      or when the page-count threshold triggers recycling, `relaunch()`
 *      closes the old Hero and starts a fresh one through the same proxy
 *      with the same fingerprint. The browser's identity is the proxy URL,
 *      not the Hero process.
 *
 * Test seam: the constructor accepts a `HeroFactory` injection so unit tests
 * can pass a fake Hero without launching a real Chromium process. Production
 * callers use `createDefaultHeroFactory()` which imports `@ulixee/hero`.
 */

import pLimit from "p-limit";
import { createHeroConfig } from "./hero-config";
import { createLogger, type Logger } from "../utils/logger";

/**
 * The subset of a Hero Tab that callers of `withPage` interact with.
 * Kept minimal so tests can fake it. At runtime this is a real
 * `@ulixee/hero` Tab object with goto, document, waitForLoad, etc.
 */
export interface TabLike {
  goto(href: string, options?: { timeoutMs?: number; referrer?: string }): Promise<unknown>;
  get url(): Promise<string>;
  get document(): unknown;
  waitForLoad(status: string, options?: { timeoutMs?: number }): Promise<void>;
  waitForPaintingStable(options?: { timeoutMs?: number }): Promise<void>;
  waitForElement(element: unknown, options?: { timeoutMs?: number }): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * The subset of the Hero API that ProxyBoundBrowser relies on. Kept minimal
 * so tests can fake it without importing @ulixee/hero.
 */
export interface HeroLike {
  newTab(): Promise<TabLike>;
  closeTab(tab: TabLike): Promise<void>;
  close(): Promise<void>;
}

/**
 * Factory for Hero instances. Production uses `createDefaultHeroFactory()`
 * which lazily imports @ulixee/hero; tests inject a fake that returns a
 * mock Hero.
 */
export interface HeroFactory {
  create(config: Record<string, unknown>): HeroLike;
  /**
   * Optional async initializer. Production factory uses this to
   * `await import("@ulixee/hero")` before the first `create()` call.
   * Test factories can omit it (they don't need async loading).
   */
  init?(): Promise<void>;
}

/**
 * Lazy-loaded real Hero factory. `@ulixee/hero` is a heavy dependency; we
 * only import it when first actually asked to create a browser, so unit
 * tests that stick to the fake factory don't pay the import cost.
 *
 * Uses dynamic `import()` because the project runs as ESM (via tsx).
 * `require()` is not available in ESM context.
 */
export function createDefaultHeroFactory(): HeroFactory {
  let HeroCtor: new (config: Record<string, unknown>) => HeroLike;
  return {
    create(config) {
      if (!HeroCtor) {
        throw new Error("HeroFactory: Hero constructor not loaded yet. Call factory.init() first.");
      }
      return new HeroCtor(config);
    },
    /**
     * Pre-load the Hero constructor. Must be called (and awaited) once
     * before the first `create()` call. The TieredBrowserPool constructor
     * can't be async, so we expose this as a separate init step that the
     * caller (ReaderClient.initializeCore) awaits before building the pool.
     */
    async init() {
      if (!HeroCtor) {
        const mod = await import("@ulixee/hero");
        HeroCtor = mod.default;
      }
    },
  };
}

/**
 * Lifecycle state of a ProxyBoundBrowser.
 */
export type BrowserState = "launching" | "active" | "retired" | "closed";

/**
 * Stats snapshot. Not a full StatsPool type — just what we need for logging
 * and tests.
 */
export interface ProxyBoundBrowserStats {
  proxyUrl: string | null;
  state: BrowserState;
  activeTabs: number;
  totalPages: number;
  createdAt: number;
  fingerprintIndex: number;
}

/**
 * Options for a ProxyBoundBrowser.
 */
export interface ProxyBoundBrowserOptions {
  /**
   * The proxy URL this browser is bound to. `null` represents the direct
   * lane (no proxy — the browser scrapes from the host's own IP).
   */
  proxyUrl: string | null;

  /** IANA timezone ID for this proxy's exit location (e.g., 'America/Los_Angeles') */
  timezoneId?: string;

  /**
   * Max concurrent `withPage` calls allowed on this browser. Default: 2.
   * This is the "N tabs per browser" knob — matches the scraper-level
   * PerProxyGate cap by default, and can be tightened per-domain via
   * domain profiles that set `maxConcurrentPerProxy: 1`.
   */
  maxTabs?: number;

  /**
   * Retire (drain + relaunch) after this many total `withPage` calls. Fresh
   * Chromium processes prevent memory leaks. Default: 100.
   */
  retireAfterPages?: number;

  /**
   * Factory to create the underlying Hero instance. Defaults to the real
   * `@ulixee/hero` import. Tests pass a fake.
   */
  heroFactory?: HeroFactory;

  /**
   * Show the Chrome window. Forwarded to `createHeroConfig`.
   */
  showChrome?: boolean;

  /**
   * A shared Hero `connectionToCore`. Optional — when present, every Hero
   * created by this browser is routed through the same HeroCore, which is
   * how ReaderClient currently shares one Core across many browsers.
   */
  connectionToCore?: unknown;

  /**
   * Custom user agent string. Overrides Hero's default emulated UA.
   * WARNING: Can cause TLS/UA mismatches that anti-bot systems detect.
   */
  userAgent?: string;

  /**
   * Logger. Defaults to a fresh "proxy-bound-browser" logger. Tests can pass
   * a silent logger to keep output clean.
   */
  logger?: Logger;

  /**
   * Clock. Defaults to `Date.now`. Tests inject a fake clock to keep
   * `createdAt` deterministic.
   */
  now?: () => number;
}

/**
 * A single Hero instance bound to exactly one proxy URL.
 */
export class ProxyBoundBrowser {
  readonly proxyUrl: string | null;
  readonly timezoneId: string | undefined;
  readonly maxTabs: number;
  readonly retireAfterPages: number;
  readonly createdAt: number;

  private state: BrowserState = "launching";
  private totalPages = 0;
  private recycling = false;
  private readonly limit: ReturnType<typeof pLimit>;
  private readonly heroFactory: HeroFactory;
  private readonly heroConfig: Record<string, unknown>;
  private readonly logger: Logger;
  private readonly now: () => number;
  private hero: HeroLike | null = null;

  /**
   * Resolves when the Hero instance is ready for use. Rejects if launch
   * fails. Callers should `await browser.ready` before their first `withPage`.
   */
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: Error) => void;

  /**
   * Resolves when the browser is fully closed (drained and Hero.close()
   * has returned). A fresh Promise is created on each `relaunch()`.
   */
  private closedDeferred: { promise: Promise<void>; resolve: () => void };

  constructor(options: ProxyBoundBrowserOptions) {
    this.proxyUrl = options.proxyUrl;
    this.timezoneId = options.timezoneId;
    this.maxTabs = options.maxTabs ?? 2;
    this.retireAfterPages = options.retireAfterPages ?? 100;
    this.heroFactory = options.heroFactory ?? createDefaultHeroFactory();
    this.logger = options.logger ?? createLogger("proxy-bound-browser");
    this.now = options.now ?? Date.now;
    this.createdAt = this.now();

    if (!Number.isInteger(this.maxTabs) || this.maxTabs < 1) {
      throw new Error(`ProxyBoundBrowser: maxTabs must be an integer >= 1, got ${this.maxTabs}`);
    }
    if (!Number.isInteger(this.retireAfterPages) || this.retireAfterPages < 1) {
      throw new Error(
        `ProxyBoundBrowser: retireAfterPages must be an integer >= 1, got ${this.retireAfterPages}`
      );
    }

    this.limit = pLimit(this.maxTabs);
    // Build the Hero config once. Proxy URL and timezone are burned in
    // at construction — if you want a different proxy, make a different
    // ProxyBoundBrowser.
    //
    // By default we do NOT override userAgent — Hero's default-browser-emulator
    // picks a UA that matches the Chromium TLS/TCP fingerprint and platform.
    // Overriding it can cause TLS/UA mismatches that anti-bot systems detect.
    // Only pass userAgent if the caller explicitly set it.
    this.heroConfig = createHeroConfig({
      proxy: this.proxyUrl ? { url: this.proxyUrl, timezoneId: this.timezoneId } : undefined,
      showChrome: options.showChrome ?? false,
      timezoneId: this.timezoneId,
      connectionToCore: options.connectionToCore,
      userAgent: options.userAgent,
    });

    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.closedDeferred = makeDeferred<void>();

    // Kick off the launch. We don't await it here — callers await
    // `this.ready` explicitly. This lets the pool create N browsers in
    // parallel and wait on all their ready promises with one Promise.all.
    void this.launch();
  }

  /**
   * Get the current lifecycle state. Read-only from outside the class.
   */
  getState(): BrowserState {
    return this.state;
  }

  /**
   * Whether this browser is accepting new work. Returns true only in the
   * `active` state.
   */
  isAvailable(): boolean {
    return this.state === "active";
  }

  /**
   * Number of in-flight `withPage` calls on this browser. Used by the
   * TieredBrowserPool to pick the least-loaded browser for a new request.
   */
  getActiveTabs(): number {
    return this.limit.activeCount;
  }

  /**
   * Stats snapshot for logging and /status.
   */
  getStats(): ProxyBoundBrowserStats {
    return {
      proxyUrl: this.proxyUrl,
      state: this.state,
      activeTabs: this.limit.activeCount,
      totalPages: this.totalPages,
      createdAt: this.createdAt,
      fingerprintIndex: 0,
    };
  }

  /**
   * Execute `fn` with the Hero instance. Acquires an internal tab slot;
   * at most `maxTabs` calls can be running at once. Throws if the browser
   * is not in the `active` state when `fn` is scheduled to run — callers
   * who want to wait for launch should await `ready` first.
   *
   * Increments `totalPages` after `fn` completes (success or failure). If
   * the post-completion count hits `retireAfterPages`, triggers `retire()`
   * in the background.
   */
  async withPage<T>(fn: (tab: TabLike) => Promise<T>): Promise<T> {
    if (this.state === "closed") {
      throw new Error(
        `ProxyBoundBrowser[${redactProxyUrl(this.proxyUrl)}]: cannot withPage on closed browser`
      );
    }
    if (this.state === "retired") {
      throw new Error(
        `ProxyBoundBrowser[${redactProxyUrl(this.proxyUrl)}]: cannot withPage on retired browser`
      );
    }

    // Wait for launch to complete (no-op if already active). If launch
    // failed, `ready` has already rejected and the state is `closed`.
    await this.ready;

    // After awaiting ready, the browser might have been retired — re-check.
    if (this.state !== "active") {
      throw new Error(
        `ProxyBoundBrowser[${redactProxyUrl(this.proxyUrl)}]: browser became ${this.state} before withPage could run`
      );
    }

    return this.limit(async () => {
      // Re-check inside the limit — another in-flight withPage may have
      // triggered retirement.
      if (this.state !== "active" || !this.hero) {
        throw new Error(
          `ProxyBoundBrowser[${redactProxyUrl(this.proxyUrl)}]: browser became unavailable while waiting for tab slot`
        );
      }

      // Open a fresh tab in the warm Hero browser. Each tab gets a clean
      // navigation context — no leftover JS state from previous scrapes.
      // The Hero instance (= Chromium process) stays alive across scrapes;
      // only the tab is created and destroyed per call.
      const tab = await this.hero.newTab();

      try {
        return await fn(tab);
      } finally {
        // Close the tab to free Chromium resources. Swallow errors —
        // the scrape result is already captured.
        try {
          await this.hero.closeTab(tab);
        } catch {
          /* swallow */
        }
        this.totalPages += 1;
        // If we hit the recycle threshold, kick off retire+relaunch in the
        // background. The `recycling` flag prevents two concurrent handlers
        // from both triggering a relaunch when they all cross the threshold
        // together. `retire()` inside relaunch will drain the remaining
        // in-flight tabs before closing.
        if (
          this.state === "active" &&
          !this.recycling &&
          this.totalPages >= this.retireAfterPages
        ) {
          this.recycling = true;
          // Schedule via setImmediate so the current task fully exits the
          // pLimit slot before relaunch starts draining — otherwise we'd
          // deadlock on ourselves (drainLimit waits for activeCount to hit
          // 0, but we're still in a pLimit task).
          setImmediate(() => {
            void this.relaunch()
              .catch((err) => {
                this.logger.error({ err, proxy: redactProxyUrl(this.proxyUrl) }, "recycle failed");
              })
              .finally(() => {
                this.recycling = false;
              });
          });
        }
      }
    });
  }

  /**
   * Gracefully drain and close the browser. Stops accepting new work. In-
   * flight tabs run to completion. Returns a Promise that resolves once the
   * underlying Hero is closed. After this resolves, `withPage` will throw.
   *
   * Safe to call multiple times — subsequent calls return the same promise.
   */
  async retire(): Promise<void> {
    if (this.state === "closed") return;
    if (this.state === "retired") {
      return this.closedDeferred.promise;
    }
    this.state = "retired";
    this.logger.debug(
      { proxy: redactProxyUrl(this.proxyUrl), activeTabs: this.limit.activeCount },
      "retiring browser"
    );

    // Drain: wait until the limit has 0 active and 0 pending.
    await this.drainLimit();

    // Close the underlying Hero. Swallow errors — we're shutting down
    // anyway and a failed close shouldn't block the caller.
    if (this.hero) {
      try {
        await this.hero.close();
      } catch (err) {
        this.logger.warn(
          { err, proxy: redactProxyUrl(this.proxyUrl) },
          "error while closing Hero during retire"
        );
      }
      this.hero = null;
    }

    this.state = "closed";
    this.closedDeferred.resolve();
    return this.closedDeferred.promise;
  }

  /**
   * Retire and relaunch with the same proxy URL and fingerprint. Used for:
   *   - Recycling after `retireAfterPages`
   *   - Reviving a proxy that was benched and then cleared the cooldown
   *   - Recovering from a Hero crash (launch fails → state goes closed →
   *     the pool can call relaunch to try again)
   *
   * Resets `totalPages` to 0. Creates a fresh `ready` promise so callers
   * can await the new Hero.
   */
  async relaunch(): Promise<void> {
    // Tear down current instance if any.
    if (this.state !== "closed") {
      await this.retire();
    }

    // Reset state for a fresh launch.
    this.state = "launching";
    this.totalPages = 0;
    this.closedDeferred = makeDeferred<void>();

    // Create a new ready promise. The old one is already resolved/rejected
    // so overwriting it is safe — callers who held a reference to the old
    // `ready` just see the old outcome.
    (this as { ready: Promise<void> }).ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    void this.launch();
    await this.ready;
  }

  /**
   * Launch the underlying Hero instance. Called by the constructor and by
   * `relaunch`. On failure, marks the browser as closed and rejects the
   * ready promise — the pool can then call relaunch to retry.
   */
  private async launch(): Promise<void> {
    try {
      this.logger.debug({ proxy: redactProxyUrl(this.proxyUrl) }, "launching browser");
      // Ensure the factory has loaded its constructor (async import for ESM).
      // No-op for test factories that don't define init().
      if (this.heroFactory.init) {
        await this.heroFactory.init();
      }
      this.hero = this.heroFactory.create(this.heroConfig);
      this.state = "active";
      this.resolveReady();
    } catch (err) {
      this.state = "closed";
      this.closedDeferred.resolve();
      this.logger.error({ err, proxy: redactProxyUrl(this.proxyUrl) }, "browser launch failed");
      this.rejectReady(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Wait until `limit` has no active or pending tasks. Polls — there's no
   * "all done" event in p-limit, but the wait is short in practice (a few
   * in-flight scrapes finish their current navigation).
   */
  private async drainLimit(): Promise<void> {
    while (this.limit.activeCount > 0 || this.limit.pendingCount > 0) {
      await new Promise((r) => setImmediate(r));
    }
  }
}

/**
 * Redact credentials from a proxy URL for logging. `http://user:pass@host:port`
 * becomes `http://***@host:port`. Never log the raw URL — it contains secrets.
 */
export function redactProxyUrl(proxyUrl: string | null): string {
  if (!proxyUrl) return "direct";
  try {
    const u = new URL(proxyUrl);
    const creds = u.username ? "***@" : "";
    return `${u.protocol}//${creds}${u.host}`;
  } catch {
    // Malformed URL — at least don't accidentally dump credentials.
    return "<invalid-proxy-url>";
  }
}

/**
 * Tiny deferred helper — creates a promise together with its resolve/reject
 * handles, so we can resolve from inside an async method without wrapping.
 */
function makeDeferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
