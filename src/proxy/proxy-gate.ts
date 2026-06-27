/**
 * PerProxyGate — per-IP concurrency cap.
 *
 * Enforces a hard limit on the number of simultaneous scrapes that can share a
 * single proxy URL, across all engines. Sitting above
 * the engines at the scraper boundary, this is what guarantees we never double-
 * book an IP even when a single scrape runs multiple engines in parallel via
 * the orchestrator waterfall.
 *
 * Design notes:
 * - Keyed by the raw proxy URL string. Same URL -> same gate. A `null` /
 *   undefined key means "no proxy" (direct connection); direct traffic is not
 *   capped per-request by this gate (the direct sub-pool's tab limit handles
 *   that downstream).
 * - Slots are acquired via pLimit, so queueing is FIFO and fair.
 * - The cap is configurable globally and overridable per-proxy, so Amazon's
 *   domain profile can drop it to 1 without affecting standard proxy throughput
 *   elsewhere.
 *
 * The "2 concurrent per IP" default is a conservative starting point. It can
 * be overridden per-proxy via `setOverride(proxyUrl, max)` for domains that
 * need tighter caps (e.g. 1 concurrent for anti-bot sites).
 */

import pLimit from "p-limit";

/**
 * Options for the PerProxyGate.
 */
export interface PerProxyGateOptions {
  /**
   * Global default for the number of concurrent scrapes allowed through a
   * single proxy URL. Must be >= 1.
   *
   * Default: 2
   */
  maxConcurrentPerProxy?: number;
}

/**
 * A release function returned from `acquire()`. Call it exactly once when the
 * scrape is finished to free the slot. `acquire()` guarantees this function is
 * safe to call any number of times — only the first call has effect.
 */
export type PerProxyRelease = () => void;

/**
 * Snapshot of a single proxy gate's current load.
 */
export interface PerProxyStats {
  /** Proxy URL. `null` represents the direct-connection lane. */
  proxyUrl: string | null;
  /** Maximum concurrent slots for this proxy. */
  max: number;
  /** Slots currently in use. */
  active: number;
  /** Requests waiting for a slot. */
  queued: number;
}

/**
 * Per-proxy concurrency gate.
 *
 * ```ts
 * const gate = new PerProxyGate({ maxConcurrentPerProxy: 2 });
 * const release = await gate.acquire("http://user:pass@dc1.example.com:8080");
 * try {
 *   // do the scrape; at most 2 other acquires for the same URL can be active
 * } finally {
 *   release();
 * }
 * ```
 */
export class PerProxyGate {
  private readonly defaultMax: number;
  private readonly gates = new Map<string, { limit: ReturnType<typeof pLimit>; max: number }>();
  private readonly overrides = new Map<string, number>();

  constructor(options: PerProxyGateOptions = {}) {
    const max = options.maxConcurrentPerProxy ?? 2;
    if (!Number.isInteger(max) || max < 1) {
      throw new Error(`PerProxyGate: maxConcurrentPerProxy must be an integer >= 1, got ${max}`);
    }
    this.defaultMax = max;
  }

  /**
   * Override the concurrency cap for a specific proxy URL. Used by domain
   * profiles that want to tighten the per-IP cap (e.g. Amazon → 1).
   *
   * Calling this after a gate already exists for the URL replaces the
   * underlying pLimit. In-flight scrapes on the old gate are unaffected and
   * continue to completion; new acquires use the new cap. This is fine for the
   * expected use (startup-time configuration), but don't rely on it for
   * hot-swapping under load.
   */
  setOverride(proxyUrl: string, max: number): void {
    if (!Number.isInteger(max) || max < 1) {
      throw new Error(`PerProxyGate: override must be an integer >= 1, got ${max}`);
    }
    this.overrides.set(proxyUrl, max);
    // Reset the gate so the next acquire picks up the new cap
    this.gates.delete(proxyUrl);
  }

  /**
   * Acquire a slot for `proxyUrl`. Resolves to a release function when the
   * slot is free. If `proxyUrl` is `null` / `undefined`, the direct-connection
   * lane is used — a single shared lane with no cap (the direct sub-pool
   * enforces its own tab limit downstream).
   *
   * Acquire never throws; queueing is unbounded. If you need a timeout, wrap
   * the returned promise in `Promise.race`.
   */
  async acquire(proxyUrl: string | null | undefined): Promise<PerProxyRelease> {
    if (!proxyUrl) {
      // Direct lane: no per-URL cap here, the browser pool's tab limit is
      // the downstream authority. Return a no-op release so callers don't
      // branch on null.
      return noopRelease();
    }

    const gate = this.gateFor(proxyUrl);

    // pLimit.acquire would be cleaner but isn't in all versions of p-limit
    // we might pin to. Use the "held promise" pattern: submit a task that
    // blocks on a manual resolver. The task holds the slot until released.
    let release!: PerProxyRelease;
    const held = new Promise<void>((resolve) => {
      release = makeRelease(resolve);
    });

    // Fire-and-forget the task that holds the slot. We must NOT await it
    // here — we want to await only the "slot acquired" signal, not the
    // "task complete" signal.
    const acquired = new Promise<void>((resolveAcquired) => {
      gate.limit(async () => {
        resolveAcquired();
        await held;
      });
    });

    await acquired;
    return release;
  }

  /**
   * Wrap an async function in an `acquire`/`release` pair. Prefer this over
   * bare `acquire()` in call sites so you can't forget to release on the
   * error path.
   */
  async withSlot<T>(proxyUrl: string | null | undefined, fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire(proxyUrl);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Inspect the current load of a specific proxy URL, or `null` if no gate
   * exists for it yet. Useful for health-tracker and /status endpoint.
   */
  stats(proxyUrl: string): PerProxyStats | null {
    const gate = this.gates.get(proxyUrl);
    if (!gate) return null;
    return {
      proxyUrl,
      max: gate.max,
      active: gate.limit.activeCount,
      queued: gate.limit.pendingCount,
    };
  }

  /**
   * Inspect the current load of every known proxy.
   */
  allStats(): PerProxyStats[] {
    return [...this.gates.entries()].map(([proxyUrl, gate]) => ({
      proxyUrl,
      max: gate.max,
      active: gate.limit.activeCount,
      queued: gate.limit.pendingCount,
    }));
  }

  /**
   * Get or create the gate for a proxy URL.
   */
  private gateFor(proxyUrl: string): { limit: ReturnType<typeof pLimit>; max: number } {
    const existing = this.gates.get(proxyUrl);
    if (existing) return existing;
    const max = this.overrides.get(proxyUrl) ?? this.defaultMax;
    const gate = { limit: pLimit(max), max };
    this.gates.set(proxyUrl, gate);
    return gate;
  }
}

/**
 * Create a release function that can be called multiple times safely.
 */
function makeRelease(resolve: () => void): PerProxyRelease {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    resolve();
  };
}

/**
 * A no-op release, used for the direct lane.
 */
function noopRelease(): PerProxyRelease {
  return () => {
    /* no-op */
  };
}
