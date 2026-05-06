import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProxyHealthTracker } from "../../src/proxy/health-tracker";

/**
 * Fake clock that the tracker reads via the injected `now` option.
 */
function fakeClock(start = 1_000_000_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("ProxyHealthTracker", () => {
  describe("defaults and validation", () => {
    it("unknown proxy is healthy by default", () => {
      const t = new ProxyHealthTracker();
      expect(t.isHealthy("http://unknown")).toBe(true);
      expect(t.snapshot("http://unknown")).toBeNull();
    });

    it("rejects invalid failureThreshold", () => {
      expect(() => new ProxyHealthTracker({ failureThreshold: 0 })).toThrow();
      expect(() => new ProxyHealthTracker({ failureThreshold: -1 })).toThrow();
      expect(() => new ProxyHealthTracker({ failureThreshold: 1.5 })).toThrow();
    });

    it("rejects negative cooldownMs", () => {
      expect(() => new ProxyHealthTracker({ cooldownMs: -1 })).toThrow();
    });
  });

  describe("bench + cooldown (default thresholds)", () => {
    it("benches after 10 consecutive failures and emits event", () => {
      const clock = fakeClock();
      const t = new ProxyHealthTracker({ now: clock.now });
      const onBench = vi.fn();
      t.on("proxy-benched", onBench);

      for (let i = 0; i < 9; i++) {
        t.recordFailure("http://dc1");
      }
      expect(t.isHealthy("http://dc1")).toBe(true);
      expect(onBench).not.toHaveBeenCalled();

      t.recordFailure("http://dc1"); // 10th
      expect(t.isHealthy("http://dc1")).toBe(false);
      expect(onBench).toHaveBeenCalledTimes(1);
      expect(onBench.mock.calls[0][0]).toMatchObject({
        proxyUrl: "http://dc1",
        consecutiveFailures: 10,
      });
    });

    it("bench event fires exactly once, not on every subsequent failure", () => {
      const clock = fakeClock();
      const t = new ProxyHealthTracker({ now: clock.now });
      const onBench = vi.fn();
      t.on("proxy-benched", onBench);

      for (let i = 0; i < 15; i++) {
        t.recordFailure("http://dc1");
      }
      expect(onBench).toHaveBeenCalledTimes(1);
    });

    it("success decays failure counter by 3 (not full reset)", () => {
      const t = new ProxyHealthTracker();
      for (let i = 0; i < 9; i++) t.recordFailure("http://dc1");
      // 9 failures → recordSuccess → decay by 3 → 6 remaining
      t.recordSuccess("http://dc1");
      expect(t.snapshot("http://dc1")?.consecutiveFailures).toBe(6);
      // 4 more failures → 6 + 4 = 10 → benched
      for (let i = 0; i < 3; i++) t.recordFailure("http://dc1");
      expect(t.isHealthy("http://dc1")).toBe(true);
      t.recordFailure("http://dc1"); // 10th total
      expect(t.isHealthy("http://dc1")).toBe(false);
    });
  });

  describe("cooldown auto-revive", () => {
    it("isHealthy returns false until cooldown expires, then true with revive event", () => {
      const clock = fakeClock();
      const t = new ProxyHealthTracker({ now: clock.now, cooldownMs: 60_000 });
      const onRevive = vi.fn();
      t.on("proxy-revived", onRevive);

      for (let i = 0; i < 10; i++) t.recordFailure("http://dc1");
      expect(t.isHealthy("http://dc1")).toBe(false);

      clock.advance(30_000);
      expect(t.isHealthy("http://dc1")).toBe(false);
      expect(onRevive).not.toHaveBeenCalled();

      clock.advance(30_001);
      expect(t.isHealthy("http://dc1")).toBe(true);
      expect(onRevive).toHaveBeenCalledTimes(1);
    });

    it("revive event fires exactly once", () => {
      const clock = fakeClock();
      const t = new ProxyHealthTracker({ now: clock.now, cooldownMs: 10 });
      const onRevive = vi.fn();
      t.on("proxy-revived", onRevive);

      for (let i = 0; i < 10; i++) t.recordFailure("http://dc1");
      clock.advance(11);
      t.isHealthy("http://dc1"); // revives
      t.isHealthy("http://dc1");
      t.isHealthy("http://dc1");
      expect(onRevive).toHaveBeenCalledTimes(1);
    });
  });

  describe("probationary failure re-benches immediately", () => {
    it("a single failure after revive re-bumps to benched on the next strike", () => {
      // After revive, the counter is still at 10. One more failure *does*
      // re-bench because it crosses the threshold again on a non-benched
      // state.
      const clock = fakeClock();
      const t = new ProxyHealthTracker({ now: clock.now, cooldownMs: 1000 });
      const onBench = vi.fn();
      t.on("proxy-benched", onBench);

      for (let i = 0; i < 10; i++) t.recordFailure("http://dc1");
      expect(onBench).toHaveBeenCalledTimes(1);

      clock.advance(1001);
      expect(t.isHealthy("http://dc1")).toBe(true); // revived

      t.recordFailure("http://dc1"); // probationary failure
      expect(t.isHealthy("http://dc1")).toBe(false);
      expect(onBench).toHaveBeenCalledTimes(2);
    });

    it("a success during probation clears the counter and unbenches", () => {
      const clock = fakeClock();
      const t = new ProxyHealthTracker({ now: clock.now, cooldownMs: 1000 });
      const onRevive = vi.fn();
      t.on("proxy-revived", onRevive);

      for (let i = 0; i < 10; i++) t.recordFailure("http://dc1");
      clock.advance(1001);
      t.isHealthy("http://dc1"); // revives, +1 onRevive
      t.recordSuccess("http://dc1");

      // After success: counter decrements by 3 (decay model) from 10 → 7.
      // Not benched because benchedUntil was cleared by isHealthy. No second
      // revive event from recordSuccess because benchedUntil was already null.
      expect(onRevive).toHaveBeenCalledTimes(1);
      expect(t.snapshot("http://dc1")?.consecutiveFailures).toBe(7);
      expect(t.isHealthy("http://dc1")).toBe(true);
    });
  });

  describe("per-proxy isolation", () => {
    it("benching dc1 does not affect dc2", () => {
      const t = new ProxyHealthTracker();
      for (let i = 0; i < 10; i++) t.recordFailure("http://dc1");
      expect(t.isHealthy("http://dc1")).toBe(false);
      expect(t.isHealthy("http://dc2")).toBe(true);
    });
  });

  describe("snapshot", () => {
    it("tracks total successes and failures over time", () => {
      const clock = fakeClock();
      const t = new ProxyHealthTracker({ now: clock.now });

      t.recordFailure("http://dc1");
      clock.advance(1000);
      t.recordSuccess("http://dc1");
      clock.advance(1000);
      t.recordFailure("http://dc1");
      clock.advance(1000);
      t.recordFailure("http://dc1");

      const s = t.snapshot("http://dc1")!;
      expect(s.totalFailures).toBe(3);
      expect(s.totalSuccesses).toBe(1);
      expect(s.consecutiveFailures).toBe(2); // reset by the success
      expect(s.lastSuccessAt).not.toBeNull();
      expect(s.lastFailureAt).not.toBeNull();
      expect(s.healthy).toBe(true);
    });

    it("allSnapshots lists every tracked proxy", () => {
      const t = new ProxyHealthTracker();
      t.recordFailure("http://dc1");
      t.recordSuccess("http://dc2");
      t.recordFailure("http://dc3");

      const all = t.allSnapshots();
      expect(all.map((s) => s.proxyUrl).sort()).toEqual([
        "http://dc1",
        "http://dc2",
        "http://dc3",
      ]);
    });
  });

  describe("reset", () => {
    it("reset drops all state for a proxy", () => {
      const t = new ProxyHealthTracker();
      for (let i = 0; i < 10; i++) t.recordFailure("http://dc1");
      expect(t.isHealthy("http://dc1")).toBe(false);

      t.reset("http://dc1");
      expect(t.isHealthy("http://dc1")).toBe(true);
      expect(t.snapshot("http://dc1")).toBeNull();
    });
  });

  describe("custom thresholds", () => {
    it("respects custom failureThreshold=3 and cooldownMs=100", () => {
      const clock = fakeClock();
      const t = new ProxyHealthTracker({
        failureThreshold: 3,
        cooldownMs: 100,
        now: clock.now,
      });

      t.recordFailure("http://dc1");
      t.recordFailure("http://dc1");
      expect(t.isHealthy("http://dc1")).toBe(true);
      t.recordFailure("http://dc1");
      expect(t.isHealthy("http://dc1")).toBe(false);

      clock.advance(101);
      expect(t.isHealthy("http://dc1")).toBe(true);
    });
  });
});
