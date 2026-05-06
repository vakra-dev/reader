/**
 * ProxyHealthTracker — minimal per-proxy circuit breaker.
 *
 * Goal: detect a dead or blacklisted proxy mid-session and take it out of
 * rotation for a fixed cooldown period, so the scraper stops burning attempts
 * on a proxy that's clearly broken. This is the runtime counterpart to the
 * startup-time `api.ipify.org` verification — startup catches dead creds and
 * misconfigured URLs; runtime tracking catches proxies that go bad after
 * they were healthy (IP got blacklisted, provider rate-limited us, etc.).
 *
 * Scope for the first cut (intentionally minimal):
 *   - Count consecutive failures per proxy URL.
 *   - After N (default 10) consecutive failures, the proxy is benched.
 *   - After M (default 5 minutes) the proxy is auto-revived and gets one
 *     "probationary" attempt. If that fails, it's benched again immediately.
 *   - A single success clears the failure counter.
 *   - Emits `proxy-benched` and `proxy-revived` events so the browser pool
 *     can react by retiring / relaunching the affected ProxyBoundBrowser.
 *
 * NOT in this version:
 *   - Failure-rate windows (just consecutive count).
 *   - Per-proxy cooldown escalation (exponential backoff, max cooldowns).
 *   - Per-destination-domain tracking (a proxy could be benched for amazon
 *     but healthy for github — we don't model that yet).
 *   - Persistence across daemon restarts.
 *   - Metrics / /status endpoint surface.
 *
 * All of those are easy extensions once the basic machinery is in place
 * and we have real e2e data showing what the thresholds should be.
 *
 * See backlog item in reader-context/BACKLOG.md for the full version.
 */

import { EventEmitter } from "node:events";

/**
 * Default knobs.
 */
export const DEFAULT_FAILURE_THRESHOLD = 10;
export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Events emitted by the tracker.
 */
export interface ProxyHealthEvents {
  "proxy-benched": (info: {
    proxyUrl: string;
    consecutiveFailures: number;
    benchedUntil: number;
  }) => void;
  "proxy-revived": (info: { proxyUrl: string }) => void;
}

/**
 * Options for the tracker.
 */
export interface ProxyHealthTrackerOptions {
  /** Consecutive failures before benching. Default: 10 */
  failureThreshold?: number;
  /** Cooldown duration in milliseconds. Default: 5 minutes */
  cooldownMs?: number;
  /**
   * Time source for testability. Defaults to `Date.now`. Tests can inject
   * a fake clock; we never reach for `Date.now()` elsewhere in this class.
   */
  now?: () => number;
}

/**
 * Per-proxy state. Not exported — the public API is `isHealthy` / `recordX`.
 */
interface ProxyState {
  consecutiveFailures: number;
  totalSuccesses: number;
  totalFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  /**
   * If set, the proxy is benched until this timestamp (ms since epoch). A
   * read after this timestamp auto-revives the proxy (no separate timer
   * needed — revival is lazy).
   */
  benchedUntil: number | null;
}

/**
 * Snapshot of a proxy's current health. For logging / /status endpoint.
 */
export interface ProxyHealthSnapshot {
  proxyUrl: string;
  healthy: boolean;
  consecutiveFailures: number;
  totalSuccesses: number;
  totalFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  benchedUntil: number | null;
}

/**
 * ProxyHealthTracker
 *
 * ```ts
 * const tracker = new ProxyHealthTracker();
 * tracker.on("proxy-benched", ({ proxyUrl }) => {
 *   browserPool.retire(proxyUrl);
 * });
 * tracker.on("proxy-revived", ({ proxyUrl }) => {
 *   browserPool.relaunch(proxyUrl);
 * });
 *
 * // In the scrape loop:
 * if (tracker.isHealthy(proxyUrl)) {
 *   try {
 *     await scrape(proxyUrl);
 *     tracker.recordSuccess(proxyUrl);
 *   } catch {
 *     tracker.recordFailure(proxyUrl);
 *     throw;
 *   }
 * }
 * ```
 */
export class ProxyHealthTracker extends EventEmitter {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly states = new Map<string, ProxyState>();

  constructor(options: ProxyHealthTrackerOptions = {}) {
    super();
    this.failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.now = options.now ?? Date.now;

    if (this.failureThreshold < 1 || !Number.isInteger(this.failureThreshold)) {
      throw new Error(
        `ProxyHealthTracker: failureThreshold must be an integer >= 1, got ${this.failureThreshold}`
      );
    }
    if (this.cooldownMs < 0) {
      throw new Error(`ProxyHealthTracker: cooldownMs must be >= 0, got ${this.cooldownMs}`);
    }
  }

  /**
   * Strongly-typed `on`/`emit`/`once`. Allows TypeScript to know the event
   * payload shape. `EventEmitter`'s default types are just `string | symbol`.
   */
  override on<E extends keyof ProxyHealthEvents>(event: E, listener: ProxyHealthEvents[E]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  override once<E extends keyof ProxyHealthEvents>(event: E, listener: ProxyHealthEvents[E]): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }
  override emit<E extends keyof ProxyHealthEvents>(
    event: E,
    ...args: Parameters<ProxyHealthEvents[E]>
  ): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Whether this proxy is currently usable. Returns true for unknown proxies
   * (innocent until proven guilty). A benched proxy whose cooldown has
   * expired is auto-revived lazily here, which also emits `proxy-revived`.
   */
  isHealthy(proxyUrl: string): boolean {
    const state = this.states.get(proxyUrl);
    if (!state) return true;
    if (state.benchedUntil === null) return true;
    if (this.now() >= state.benchedUntil) {
      // Cooldown expired — revive on probation (counter stays at threshold
      // so that a single failure immediately re-benches).
      state.benchedUntil = null;
      this.emit("proxy-revived", { proxyUrl });
      return true;
    }
    return false;
  }

  /**
   * Record a successful scrape through this proxy. Decrements the failure
   * counter by 3 (so successes erode failures gradually rather than
   * requiring a full reset). If the proxy was benched and we got a
   * success anyway (probationary attempt after cooldown), clear the bench.
   */
  recordSuccess(proxyUrl: string): void {
    const state = this.ensureState(proxyUrl);
    const wasBenched = state.benchedUntil !== null;
    // Decay: each success erodes 3 failure points instead of full reset.
    // A proxy that alternates success/failure stays healthy (3:1 ratio).
    // A proxy that gets 10 failures in a row still benches quickly.
    state.consecutiveFailures = Math.max(0, state.consecutiveFailures - 3);
    state.totalSuccesses += 1;
    state.lastSuccessAt = this.now();
    state.benchedUntil = null;
    if (wasBenched) {
      this.emit("proxy-revived", { proxyUrl });
    }
  }

  /**
   * Record a failed scrape through this proxy. Increments the counter and
   * benches the proxy if the threshold is reached. Emits `proxy-benched`
   * exactly once per bench transition.
   */
  recordFailure(proxyUrl: string): void {
    const state = this.ensureState(proxyUrl);
    state.consecutiveFailures += 1;
    state.totalFailures += 1;
    state.lastFailureAt = this.now();

    // Already benched — don't re-emit and don't extend the cooldown. A
    // probationary failure (cooldown expired, isHealthy() re-activated it)
    // will arrive with benchedUntil == null, so we fall through and re-bench
    // below.
    if (state.benchedUntil !== null) {
      return;
    }

    if (state.consecutiveFailures >= this.failureThreshold) {
      state.benchedUntil = this.now() + this.cooldownMs;
      this.emit("proxy-benched", {
        proxyUrl,
        consecutiveFailures: state.consecutiveFailures,
        benchedUntil: state.benchedUntil,
      });
    }
  }

  /**
   * Snapshot the health of a single proxy. Returns null for unknown URLs.
   * Does NOT auto-revive — unlike `isHealthy`, this is a pure read.
   */
  snapshot(proxyUrl: string): ProxyHealthSnapshot | null {
    const state = this.states.get(proxyUrl);
    if (!state) return null;
    return {
      proxyUrl,
      healthy: state.benchedUntil === null || this.now() >= state.benchedUntil,
      consecutiveFailures: state.consecutiveFailures,
      totalSuccesses: state.totalSuccesses,
      totalFailures: state.totalFailures,
      lastSuccessAt: state.lastSuccessAt,
      lastFailureAt: state.lastFailureAt,
      benchedUntil: state.benchedUntil,
    };
  }

  /**
   * Snapshot every tracked proxy.
   */
  allSnapshots(): ProxyHealthSnapshot[] {
    return [...this.states.keys()]
      .map((url) => this.snapshot(url))
      .filter((s): s is ProxyHealthSnapshot => s !== null);
  }

  /**
   * Manually reset a proxy's state. Used by `ipify` startup verification:
   * if verification passes after a history of failures, clear the slate.
   */
  reset(proxyUrl: string): void {
    this.states.delete(proxyUrl);
  }

  private ensureState(proxyUrl: string): ProxyState {
    let state = this.states.get(proxyUrl);
    if (!state) {
      state = {
        consecutiveFailures: 0,
        totalSuccesses: 0,
        totalFailures: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
        benchedUntil: null,
      };
      this.states.set(proxyUrl, state);
    }
    return state;
  }
}
