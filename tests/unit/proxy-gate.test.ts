import { describe, it, expect } from "vitest";
import { PerProxyGate } from "../../src/proxy/proxy-gate";

/**
 * Helper: a deferred that you can resolve from outside. Tests use this to
 * hold slots for as long as they want.
 */
function defer<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * Helper: let microtasks and timers flush before the next assertion. Gives
 * pLimit a chance to move its queue forward.
 */
async function tick(n = 1) {
  for (let i = 0; i < n; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

describe("PerProxyGate", () => {
  describe("constructor", () => {
    it("defaults to maxConcurrentPerProxy=2", async () => {
      const gate = new PerProxyGate();
      const d1 = defer();
      const d2 = defer();
      const d3 = defer();

      // Hold 2 slots
      const acquired: Array<Promise<void>> = [];
      const releases: Array<() => void> = [];
      for (const d of [d1, d2]) {
        const p = gate.acquire("http://dc1").then((r) => {
          releases.push(r);
          return d.promise;
        });
        acquired.push(p);
      }
      await tick(2);

      // Both should be running
      expect(gate.stats("http://dc1")?.active).toBe(2);

      // A third should be queued
      let thirdAcquired = false;
      const third = gate.acquire("http://dc1").then((r) => {
        thirdAcquired = true;
        releases.push(r);
        return d3.promise;
      });
      await tick(2);
      expect(thirdAcquired).toBe(false);
      expect(gate.stats("http://dc1")?.queued).toBe(1);

      // Release one — third should run
      d1.resolve();
      releases[0]!();
      await tick(2);
      expect(thirdAcquired).toBe(true);

      // Cleanup
      d2.resolve();
      d3.resolve();
      releases.forEach((r) => r());
      await Promise.all([...acquired, third]);
    });

    it("rejects non-integer or <1 max", () => {
      expect(() => new PerProxyGate({ maxConcurrentPerProxy: 0 })).toThrow();
      expect(() => new PerProxyGate({ maxConcurrentPerProxy: -1 })).toThrow();
      expect(() => new PerProxyGate({ maxConcurrentPerProxy: 1.5 })).toThrow();
    });

    it("accepts custom maxConcurrentPerProxy", async () => {
      const gate = new PerProxyGate({ maxConcurrentPerProxy: 1 });
      const d1 = defer();
      const d2 = defer();

      let secondAcquired = false;
      const r1p = gate.acquire("http://p").then((r) => d1.promise.then(() => r));
      await tick(2);
      const r2p = gate.acquire("http://p").then((r) => {
        secondAcquired = true;
        return d2.promise.then(() => r);
      });
      await tick(2);

      expect(secondAcquired).toBe(false);
      expect(gate.stats("http://p")?.active).toBe(1);

      // Release first
      d1.resolve();
      const r1 = await r1p;
      r1();
      await tick(2);

      expect(secondAcquired).toBe(true);
      d2.resolve();
      const r2 = await r2p;
      r2();
    });
  });

  describe("per-proxy isolation", () => {
    it("does not cross-gate different proxy URLs", async () => {
      const gate = new PerProxyGate({ maxConcurrentPerProxy: 1 });
      const d1 = defer();
      const d2 = defer();

      // Hold dc1's slot
      const r1p = gate.acquire("http://dc1").then((r) => d1.promise.then(() => r));
      await tick(2);

      // dc2 should NOT be blocked by dc1
      let dc2Ok = false;
      const r2p = gate.acquire("http://dc2").then((r) => {
        dc2Ok = true;
        return d2.promise.then(() => r);
      });
      await tick(2);

      expect(dc2Ok).toBe(true);
      expect(gate.stats("http://dc1")?.active).toBe(1);
      expect(gate.stats("http://dc2")?.active).toBe(1);

      d1.resolve();
      d2.resolve();
      (await r1p)();
      (await r2p)();
    });

    it("direct lane (null proxyUrl) never blocks", async () => {
      const gate = new PerProxyGate({ maxConcurrentPerProxy: 1 });

      // Acquire 5 direct slots all at once
      const releases = await Promise.all([
        gate.acquire(null),
        gate.acquire(undefined),
        gate.acquire(null),
        gate.acquire(null),
        gate.acquire(null),
      ]);

      expect(releases).toHaveLength(5);
      releases.forEach((r) => r());
    });

    it("direct lane does not appear in stats (no gate is created)", async () => {
      const gate = new PerProxyGate();
      const release = await gate.acquire(null);
      expect(gate.allStats()).toEqual([]);
      release();
    });
  });

  describe("withSlot", () => {
    it("releases on success", async () => {
      const gate = new PerProxyGate({ maxConcurrentPerProxy: 1 });
      const result = await gate.withSlot("http://p", async () => 42);
      expect(result).toBe(42);
      await tick(2);
      expect(gate.stats("http://p")?.active).toBe(0);
    });

    it("releases on error", async () => {
      const gate = new PerProxyGate({ maxConcurrentPerProxy: 1 });
      await expect(
        gate.withSlot("http://p", async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      await tick(2);
      expect(gate.stats("http://p")?.active).toBe(0);

      // Must be usable again after the failure
      const ok = await gate.withSlot("http://p", async () => "ok");
      expect(ok).toBe("ok");
    });

    it("serializes withSlot calls on the same proxy", async () => {
      const gate = new PerProxyGate({ maxConcurrentPerProxy: 1 });
      const order: string[] = [];
      const a = gate.withSlot("http://p", async () => {
        order.push("a-start");
        await tick(1);
        order.push("a-end");
      });
      const b = gate.withSlot("http://p", async () => {
        order.push("b-start");
        order.push("b-end");
      });
      await Promise.all([a, b]);
      expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
    });
  });

  describe("release idempotency", () => {
    it("release function is safe to call multiple times", async () => {
      const gate = new PerProxyGate({ maxConcurrentPerProxy: 1 });
      const r = await gate.acquire("http://p");
      r();
      r();
      r();
      // Next acquire should succeed immediately
      const r2 = await gate.acquire("http://p");
      expect(gate.stats("http://p")?.active).toBe(1);
      r2();
    });
  });

  describe("per-proxy override", () => {
    it("setOverride tightens the cap for a specific URL", async () => {
      const gate = new PerProxyGate({ maxConcurrentPerProxy: 2 });
      gate.setOverride("http://amazon", 1);

      const d1 = defer();
      let secondAcquired = false;

      const r1p = gate.acquire("http://amazon").then((r) => d1.promise.then(() => r));
      await tick(2);

      const r2p = gate.acquire("http://amazon").then((r) => {
        secondAcquired = true;
        return r;
      });
      await tick(2);

      expect(secondAcquired).toBe(false);
      d1.resolve();
      (await r1p)();
      await tick(2);
      expect(secondAcquired).toBe(true);
      (await r2p)();
    });

    it("override only affects the named URL", async () => {
      const gate = new PerProxyGate({ maxConcurrentPerProxy: 2 });
      gate.setOverride("http://amazon", 1);

      // Other proxies still get the default of 2
      const d1 = defer();
      const d2 = defer();
      const r1p = gate.acquire("http://other").then((r) => d1.promise.then(() => r));
      const r2p = gate.acquire("http://other").then((r) => d2.promise.then(() => r));
      await tick(2);

      expect(gate.stats("http://other")?.active).toBe(2);

      d1.resolve();
      d2.resolve();
      (await r1p)();
      (await r2p)();
    });

    it("rejects invalid override values", () => {
      const gate = new PerProxyGate();
      expect(() => gate.setOverride("http://p", 0)).toThrow();
      expect(() => gate.setOverride("http://p", -1)).toThrow();
      expect(() => gate.setOverride("http://p", 1.5)).toThrow();
    });
  });

  describe("stats", () => {
    it("returns null for unknown URL", () => {
      const gate = new PerProxyGate();
      expect(gate.stats("http://unknown")).toBeNull();
    });

    it("reports active + queued counts", async () => {
      const gate = new PerProxyGate({ maxConcurrentPerProxy: 1 });
      const d1 = defer();
      const r1p = gate.acquire("http://p").then((r) => d1.promise.then(() => r));
      await tick(2);
      // Queue 2 more
      const r2p = gate.acquire("http://p");
      const r3p = gate.acquire("http://p");
      await tick(2);

      const s = gate.stats("http://p");
      expect(s).toEqual({
        proxyUrl: "http://p",
        max: 1,
        active: 1,
        queued: 2,
      });

      d1.resolve();
      (await r1p)();
      (await r2p)();
      (await r3p)();
    });

    it("allStats lists every known gate", async () => {
      const gate = new PerProxyGate();
      await (await gate.acquire("http://a"))();
      await (await gate.acquire("http://b"))();
      const all = gate.allStats();
      expect(all.map((s) => s.proxyUrl).sort()).toEqual(["http://a", "http://b"]);
    });
  });
});
