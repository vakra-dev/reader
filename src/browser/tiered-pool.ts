/**
 * TieredBrowserPool — the top-level browser pool for Reader.
 *
 * Composes N ProxyBoundBrowser instances grouped by tier
 * (datacenter / residential / direct), with one browser per proxy URL. The
 * pool owns the lifecycle of its browsers: it pre-warms every browser at
 * startup, routes `acquire(tier)` to the least-loaded healthy browser in
 * that tier, and reacts to `proxy-benched` / `proxy-revived` events from the
 * injected ProxyHealthTracker by retiring or relaunching browsers.
 *
 * Architecture rules (from the design review):
 *   - 1 proxy URL = 1 ProxyBoundBrowser. Never two browsers on the same URL.
 *   - Browsers are pre-warmed at startup in parallel (Promise.all across all
 *     ready promises). `ready` on the pool resolves when all browsers have
 *     reported ready — success or failure — so the daemon can fail loud at
 *     startup via a separate `api.ipify.org` verification step.
 *   - `acquire(tier)` picks the least-loaded healthy browser in the tier. If
 *     none exist, it throws — callers should check `hasTier(tier)` first or
 *     handle the error as a tier-unavailable case (e.g., fall back to a
 *     different tier or return a structured error to the API).
 *   - The direct tier is only populated when no proxies are configured at
 *     all (see `buildFromPools` below). Mixing direct with proxies is a
 *     config error that leaks your real IP.
 *
 * This is *not* a drop-in replacement for the old `BrowserPool` — the API is
 * new (`acquire(tier)` instead of `withBrowser(fn)`). The scraper and hero
 * engine are updated separately in a later phase to use this shape.
 */

import {
  ProxyBoundBrowser,
  type HeroFactory,
  type ProxyBoundBrowserOptions,
  type ProxyBoundBrowserStats,
  redactProxyUrl,
} from "./proxy-bound-browser";
import type { ProxyHealthTracker } from "../proxy/health-tracker";
import { createLogger, type Logger } from "../utils/logger";

/**
 * The three tiers we support. `direct` is only populated when there are no
 * configured proxies (local dev, CI without secrets).
 */
export type PoolTier = "datacenter" | "residential" | "direct";

/**
 * Input to the pool: a tier name and the list of proxy URLs for that tier.
 *
 * A null URL inside `direct` represents the actual direct connection. For
 * `datacenter` and `residential`, the URLs are real proxy URLs.
 */
export interface TierConfig {
  tier: PoolTier;
  proxyUrls: Array<string | null>;
  /** Map of proxy URL -> IANA timezone ID for Hero fingerprint consistency. */
  timezones?: Record<string, string>;
}

/**
 * Options for the TieredBrowserPool.
 */
export interface TieredBrowserPoolOptions {
  /**
   * The tiers and their proxy URLs. Use `buildFromPools()` helper to
   * convert a ProxyPoolConfig into this shape.
   */
  tiers: TierConfig[];

  /**
   * Max concurrent tabs per browser. Default: 2. Matches the scraper-level
   * PerProxyGate default; the two layers together give us defence in depth.
   */
  maxTabsPerBrowser?: number;

  /**
   * Page-count threshold for browser recycling. Default: 100 (matches the
   * old pool).
   */
  retireAfterPages?: number;

  /**
   * Optional ProxyHealthTracker. When supplied, the pool subscribes to its
   * `proxy-benched` and `proxy-revived` events: benched proxies get their
   * browser retired, revived proxies get a fresh one launched. Without a
   * tracker, the pool ignores proxy health and relies purely on the
   * scraper's retry loop.
   */
  healthTracker?: ProxyHealthTracker;

  /**
   * Factory for Hero instances. Passed through to every ProxyBoundBrowser.
   * Tests inject a fake; production leaves it undefined (uses the real
   * `@ulixee/hero`).
   */
  heroFactory?: HeroFactory;

  /**
   * Show Chrome window. Forwarded to every browser.
   */
  showChrome?: boolean;

  /**
   * Shared Hero `connectionToCore`. One HeroCore shared across all browsers
   * avoids spinning up N Core processes.
   */
  connectionToCore?: unknown;

  /**
   * Custom user agent string. Forwarded to every browser.
   * Overrides Hero's default emulated UA.
   */
  userAgent?: string;

  /**
   * Logger. Defaults to a fresh "tiered-pool" logger.
   */
  logger?: Logger;
}

/**
 * A result from `acquire(tier)`. Callers should `await lease.ready` (no-op
 * if already ready) and then use `lease.withPage(fn)` for the actual work.
 * Release is implicit — withPage releases its own slot.
 */
export interface BrowserLease {
  /** The ProxyBoundBrowser you're using. */
  browser: ProxyBoundBrowser;
  /** The tier it was leased from. */
  tier: PoolTier;
}

/**
 * Stats for a tier.
 */
export interface TierStats {
  tier: PoolTier;
  browsers: ProxyBoundBrowserStats[];
}

/**
 * Stats for the whole pool.
 */
export interface PoolStatsSnapshot {
  tiers: TierStats[];
}

/**
 * The pool.
 */
export class TieredBrowserPool {
  private readonly tiers = new Map<PoolTier, Map<string, ProxyBoundBrowser>>();
  private readonly healthTracker?: ProxyHealthTracker;
  private readonly maxTabsPerBrowser: number;
  private readonly retireAfterPages: number;
  private readonly heroFactory?: HeroFactory;
  private readonly showChrome: boolean;
  private readonly connectionToCore?: unknown;
  private readonly userAgent?: string;
  private readonly logger: Logger;
  /** Keyed by proxy URL ("" for null/direct) -> tier, so event handlers can find the right tier. */
  private readonly proxyToTier = new Map<string, PoolTier>();
  private closed = false;

  /**
   * Resolves when every browser has completed its initial launch attempt
   * (success or failure). Success failures are NOT thrown here — this is
   * not the health check, it's the "pre-warm finished" gate. The separate
   * `api.ipify.org` verification step in daemon startup is responsible for
   * actually validating that traffic flows through each proxy.
   */
  readonly ready: Promise<void>;

  constructor(options: TieredBrowserPoolOptions) {
    this.maxTabsPerBrowser = options.maxTabsPerBrowser ?? 2;
    this.retireAfterPages = options.retireAfterPages ?? 100;
    this.healthTracker = options.healthTracker;
    this.heroFactory = options.heroFactory;
    this.showChrome = options.showChrome ?? false;
    this.connectionToCore = options.connectionToCore;
    this.userAgent = options.userAgent;
    this.logger = options.logger ?? createLogger("tiered-pool");

    // Build every browser up front. No lazy launch.
    const readyPromises: Promise<unknown>[] = [];

    for (const tierConfig of options.tiers) {
      const map = new Map<string, ProxyBoundBrowser>();
      for (const proxyUrl of tierConfig.proxyUrls) {
        const key = proxyUrlKey(proxyUrl);
        if (map.has(key)) {
          this.logger.warn(
            { proxy: redactProxyUrl(proxyUrl), tier: tierConfig.tier },
            "duplicate proxy URL in tier; skipping duplicate"
          );
          continue;
        }
        const timezoneId = proxyUrl ? tierConfig.timezones?.[proxyUrl] : undefined;
        const browser = this.createBrowser(proxyUrl, timezoneId);
        map.set(key, browser);
        this.proxyToTier.set(key, tierConfig.tier);
        // Swallow per-browser launch failures — one dead browser shouldn't
        // block the pool's ready promise. The startup health check in the
        // daemon is responsible for failing loud.
        readyPromises.push(
          browser.ready.catch((err) => {
            this.logger.error(
              { err, proxy: redactProxyUrl(proxyUrl), tier: tierConfig.tier },
              "browser failed to launch during pool startup"
            );
          })
        );
      }
      this.tiers.set(tierConfig.tier, map);
    }

    this.ready = Promise.all(readyPromises).then(() => undefined);

    // Subscribe to health events if a tracker was provided.
    if (this.healthTracker) {
      this.attachHealthListeners(this.healthTracker);
    }
  }

  /**
   * Acquire the least-loaded healthy browser from a tier. Does NOT hold a
   * lock — the caller must invoke `lease.browser.withPage(fn)` to actually
   * run something, and `withPage` takes the tab slot.
   *
   * Throws if the tier has no browsers at all, or if every browser in the
   * tier is unavailable (launching, retired, closed, or benched). Callers
   * should catch and either fall back to another tier or return a structured
   * error.
   */
  acquire(tier: PoolTier): BrowserLease {
    if (this.closed) {
      throw new Error("TieredBrowserPool: pool is closed");
    }
    const map = this.tiers.get(tier);
    if (!map || map.size === 0) {
      throw new Error(`TieredBrowserPool: no browsers configured for tier "${tier}"`);
    }

    // Pick least-loaded among browsers that are active (not launching,
    // retired, closed) and — if we have a tracker — healthy.
    let best: ProxyBoundBrowser | null = null;
    let bestLoad = Infinity;

    for (const browser of map.values()) {
      if (!browser.isAvailable()) continue;
      if (this.healthTracker && !this.healthTracker.isHealthy(browser.proxyUrl ?? "")) {
        continue;
      }
      const load = browser.getActiveTabs();
      if (load < bestLoad) {
        best = browser;
        bestLoad = load;
      }
    }

    if (!best) {
      throw new Error(
        `TieredBrowserPool: no available browsers in tier "${tier}" ` +
          `(all launching, retired, or benched)`
      );
    }

    return { browser: best, tier };
  }

  /**
   * Whether this tier has any configured browsers (not whether they're
   * available right now). Useful for caller-side tier fallback logic.
   */
  hasTier(tier: PoolTier): boolean {
    const map = this.tiers.get(tier);
    return !!map && map.size > 0;
  }

  /**
   * Look up the browser bound to a specific proxy URL, regardless of tier.
   * Returns null if no such browser exists. Used by the Hero engine when
   * the scraper has already resolved a proxy URL and needs the exact
   * browser bound to it.
   */
  getBrowserByProxy(proxyUrl: string | null): ProxyBoundBrowser | null {
    const tier = this.proxyToTier.get(proxyUrlKey(proxyUrl));
    if (!tier) return null;
    const map = this.tiers.get(tier);
    if (!map) return null;
    return map.get(proxyUrlKey(proxyUrl)) ?? null;
  }

  /**
   * Snapshot stats for every browser in every tier.
   */
  getStats(): PoolStatsSnapshot {
    const tiers: TierStats[] = [];
    for (const [tier, map] of this.tiers.entries()) {
      const browsers: ProxyBoundBrowserStats[] = [];
      for (const browser of map.values()) {
        browsers.push(browser.getStats());
      }
      tiers.push({ tier, browsers });
    }
    return { tiers };
  }

  /**
   * Shut down the whole pool. Retires every browser in parallel.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const retirements: Promise<void>[] = [];
    for (const map of this.tiers.values()) {
      for (const browser of map.values()) {
        retirements.push(browser.retire().catch(() => undefined));
      }
    }
    await Promise.all(retirements);
  }

  /**
   * Create a fresh ProxyBoundBrowser with the pool's shared config.
   */
  private createBrowser(proxyUrl: string | null, timezoneId?: string): ProxyBoundBrowser {
    const opts: ProxyBoundBrowserOptions = {
      proxyUrl,
      timezoneId,
      maxTabs: this.maxTabsPerBrowser,
      retireAfterPages: this.retireAfterPages,
      heroFactory: this.heroFactory,
      showChrome: this.showChrome,
      connectionToCore: this.connectionToCore,
      userAgent: this.userAgent,
      logger: this.logger,
    };
    return new ProxyBoundBrowser(opts);
  }

  /**
   * Wire up event listeners on the ProxyHealthTracker so the pool reacts to
   * runtime bench/revive signals:
   *
   *   proxy-benched  -> retire() the corresponding browser (drain + close).
   *                     The browser stays in the map but is in the "closed"
   *                     state, so acquire() will skip it.
   *
   *   proxy-revived  -> relaunch() the corresponding browser, restoring it
   *                     to "active" with a fresh Hero process.
   */
  private attachHealthListeners(tracker: ProxyHealthTracker): void {
    tracker.on("proxy-benched", ({ proxyUrl }) => {
      const browser = this.getBrowserByProxy(proxyUrl);
      if (!browser) return;
      this.logger.warn({ proxy: redactProxyUrl(proxyUrl) }, "proxy benched, retiring browser");
      void browser.retire().catch((err) => {
        this.logger.error(
          { err, proxy: redactProxyUrl(proxyUrl) },
          "failed to retire benched browser"
        );
      });
    });

    tracker.on("proxy-revived", ({ proxyUrl }) => {
      const browser = this.getBrowserByProxy(proxyUrl);
      if (!browser) return;
      this.logger.info({ proxy: redactProxyUrl(proxyUrl) }, "proxy revived, relaunching browser");
      void browser.relaunch().catch((err) => {
        this.logger.error(
          { err, proxy: redactProxyUrl(proxyUrl) },
          "failed to relaunch revived browser"
        );
      });
    });
  }
}

/**
 * Build a TieredBrowserPool config from the existing ProxyPoolConfig shape
 * used by the daemon's env parser. Applies the rule:
 *
 *   - If datacenter OR residential proxies are configured, the direct tier
 *     is EMPTY. We never leak the host IP when proxies exist.
 *   - If no proxies are configured anywhere, create a single direct browser
 *     (sized by `directPoolSize`, default 1).
 *
 * This matches the mental model we agreed on earlier in the design review.
 */
export function buildTierConfigsFromPools(
  pools:
    | {
        datacenter?: Array<{ url?: string; timezoneId?: string }>;
        residential?: Array<{ url?: string; timezoneId?: string }>;
      }
    | undefined,
  opts: { directPoolSize?: number } = {}
): TierConfig[] {
  const directSize = opts.directPoolSize ?? 1;

  function extract(list: Array<{ url?: string; timezoneId?: string }> | undefined) {
    const urls: string[] = [];
    const timezones: Record<string, string> = {};
    for (const p of list ?? []) {
      const url = p.url ?? "";
      if (url.length === 0) continue;
      urls.push(url);
      if (p.timezoneId) timezones[url] = p.timezoneId;
    }
    return { urls, timezones: Object.keys(timezones).length > 0 ? timezones : undefined };
  }

  const dc = extract(pools?.datacenter);
  const res = extract(pools?.residential);

  const tiers: TierConfig[] = [];

  if (dc.urls.length > 0 || res.urls.length > 0) {
    if (dc.urls.length > 0) {
      tiers.push({ tier: "datacenter", proxyUrls: dc.urls, timezones: dc.timezones });
    }
    if (res.urls.length > 0) {
      tiers.push({ tier: "residential", proxyUrls: res.urls, timezones: res.timezones });
    }
    // No direct tier when proxies exist — direct: 0.
  } else {
    // No proxies configured anywhere. Spin up a direct-only pool.
    const directUrls: Array<string | null> = Array.from({ length: directSize }, () => null);
    tiers.push({ tier: "direct", proxyUrls: directUrls });
  }

  return tiers;
}

/**
 * Canonical key for a proxy URL in the pool's maps. null/undefined collapse
 * to the empty string so the direct lane has a stable key.
 */
function proxyUrlKey(proxyUrl: string | null | undefined): string {
  return proxyUrl ?? "";
}

/**
 * Re-export TabLike so callers who only import from `tiered-pool` don't
 * also need to import from `proxy-bound-browser`.
 */
export type { TabLike } from "./proxy-bound-browser";
