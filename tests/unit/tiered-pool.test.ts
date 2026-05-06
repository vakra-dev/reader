import { describe, it, expect } from "vitest";
import pino from "pino";
import {
  TieredBrowserPool,
  buildTierConfigsFromPools,
} from "../../src/browser/tiered-pool";
import type { HeroFactory, HeroLike, TabLike } from "../../src/browser/proxy-bound-browser";
import { ProxyHealthTracker } from "../../src/proxy/health-tracker";

const silentLogger = pino({ level: "silent" });

interface FakeHero extends HeroLike {
  config: Record<string, unknown>;
  closed: boolean;
}

function makeFakeTab(): TabLike {
  return {
    async goto() { return undefined; },
    get url() { return Promise.resolve("about:blank"); },
    get document() { return {} as unknown; },
    async waitForLoad() {},
    async waitForPaintingStable() {},
    async waitForElement() { return undefined as unknown; },
    async close() {},
  };
}

function makeFakeFactory(opts: { failFor?: Set<string> } = {}): {
  factory: HeroFactory;
  instances: FakeHero[];
} {
  const instances: FakeHero[] = [];
  const factory: HeroFactory = {
    create(config: Record<string, unknown>) {
      const url = (config.upstreamProxyUrl as string | undefined) ?? null;
      if (url && opts.failFor?.has(url)) {
        throw new Error(`launch failed for ${url}`);
      }
      const hero: FakeHero = {
        config,
        closed: false,
        async newTab() { return makeFakeTab(); },
        async closeTab(tab: TabLike) { await tab.close(); },
        async close() {
          this.closed = true;
        },
      };
      instances.push(hero);
      return hero;
    },
  };
  return { factory, instances };
}

async function tick(n = 1) {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

describe("TieredBrowserPool", () => {
  describe("construction + pre-warm", () => {
    it("launches one browser per proxy URL at startup", async () => {
      const { factory, instances } = makeFakeFactory();
      const pool = new TieredBrowserPool({
        tiers: [
          {
            tier: "datacenter",
            proxyUrls: ["http://dc1", "http://dc2", "http://dc3"],
          },
        ],
        heroFactory: factory,
        logger: silentLogger,
      });
      await pool.ready;
      expect(instances).toHaveLength(3);
      expect(pool.getStats().tiers[0].browsers).toHaveLength(3);
      await pool.close();
    });

    it("skips duplicate proxy URLs within a tier", async () => {
      const { factory, instances } = makeFakeFactory();
      const pool = new TieredBrowserPool({
        tiers: [
          {
            tier: "datacenter",
            proxyUrls: ["http://dc1", "http://dc1", "http://dc2"],
          },
        ],
        heroFactory: factory,
        logger: silentLogger,
      });
      await pool.ready;
      expect(instances).toHaveLength(2);
      await pool.close();
    });

    it("tolerates a per-browser launch failure and resolves ready anyway", async () => {
      const { factory } = makeFakeFactory({ failFor: new Set(["http://bad"]) });
      const pool = new TieredBrowserPool({
        tiers: [
          {
            tier: "datacenter",
            proxyUrls: ["http://dc1", "http://bad", "http://dc2"],
          },
        ],
        heroFactory: factory,
        logger: silentLogger,
      });
      await pool.ready; // should not throw
      const stats = pool.getStats();
      const dcBrowsers = stats.tiers.find((t) => t.tier === "datacenter")!.browsers;
      expect(dcBrowsers).toHaveLength(3);
      const closedCount = dcBrowsers.filter((b) => b.state === "closed").length;
      expect(closedCount).toBe(1);
      await pool.close();
    });
  });

  describe("acquire", () => {
    it("returns least-loaded browser from the tier", async () => {
      const { factory } = makeFakeFactory();
      const pool = new TieredBrowserPool({
        tiers: [
          {
            tier: "datacenter",
            proxyUrls: ["http://dc1", "http://dc2"],
          },
        ],
        heroFactory: factory,
        logger: silentLogger,
      });
      await pool.ready;

      // Hold dc1 with an in-flight page
      const dc1 = pool.acquire("datacenter").browser;
      let releaseDc1!: () => void;
      const heldDc1 = new Promise<void>((r) => (releaseDc1 = r));
      const dc1Page = dc1.withPage(async () => {
        await heldDc1;
      });
      await tick(2);

      // The next acquire should prefer the OTHER browser (dc2)
      const lease = pool.acquire("datacenter");
      expect(lease.browser).not.toBe(dc1);

      releaseDc1();
      await dc1Page;
      await pool.close();
    });

    it("throws when tier is unknown", async () => {
      const { factory } = makeFakeFactory();
      const pool = new TieredBrowserPool({
        tiers: [{ tier: "datacenter", proxyUrls: ["http://dc1"] }],
        heroFactory: factory,
        logger: silentLogger,
      });
      await pool.ready;
      expect(() => pool.acquire("residential")).toThrow(/no browsers configured for tier/);
      await pool.close();
    });

    it("throws when all browsers in the tier are unavailable", async () => {
      const { factory } = makeFakeFactory();
      const pool = new TieredBrowserPool({
        tiers: [
          {
            tier: "datacenter",
            proxyUrls: ["http://dc1", "http://dc2"],
          },
        ],
        heroFactory: factory,
        logger: silentLogger,
      });
      await pool.ready;
      // Retire both
      const lease1 = pool.acquire("datacenter");
      const lease2 = pool.acquire("datacenter");
      // They might be the same browser (least-loaded) — force retire via stats map
      for (const tierStats of pool.getStats().tiers) {
        for (const _ of tierStats.browsers) {
          /* retirement below */
        }
      }
      // Actually retire both via pool.close? No, we want the pool open but
      // browsers unavailable. Grab them via getBrowserByProxy.
      const b1 = pool.getBrowserByProxy("http://dc1")!;
      const b2 = pool.getBrowserByProxy("http://dc2")!;
      await Promise.all([b1.retire(), b2.retire()]);

      expect(() => pool.acquire("datacenter")).toThrow(/no available browsers/);
      await pool.close();
      void lease1;
      void lease2;
    });
  });

  describe("hasTier", () => {
    it("returns true for configured tiers", async () => {
      const { factory } = makeFakeFactory();
      const pool = new TieredBrowserPool({
        tiers: [{ tier: "datacenter", proxyUrls: ["http://dc1"] }],
        heroFactory: factory,
        logger: silentLogger,
      });
      await pool.ready;
      expect(pool.hasTier("datacenter")).toBe(true);
      expect(pool.hasTier("residential")).toBe(false);
      expect(pool.hasTier("direct")).toBe(false);
      await pool.close();
    });
  });

  describe("getBrowserByProxy", () => {
    it("returns the browser bound to a proxy URL", async () => {
      const { factory } = makeFakeFactory();
      const pool = new TieredBrowserPool({
        tiers: [
          {
            tier: "datacenter",
            proxyUrls: ["http://dc1", "http://dc2"],
          },
        ],
        heroFactory: factory,
        logger: silentLogger,
      });
      await pool.ready;
      const b1 = pool.getBrowserByProxy("http://dc1")!;
      const b2 = pool.getBrowserByProxy("http://dc2")!;
      expect(b1.proxyUrl).toBe("http://dc1");
      expect(b2.proxyUrl).toBe("http://dc2");
      expect(pool.getBrowserByProxy("http://dc3")).toBeNull();
      await pool.close();
    });

    it("resolves null for the direct lane", async () => {
      const { factory } = makeFakeFactory();
      const pool = new TieredBrowserPool({
        tiers: [{ tier: "direct", proxyUrls: [null] }],
        heroFactory: factory,
        logger: silentLogger,
      });
      await pool.ready;
      const direct = pool.getBrowserByProxy(null);
      expect(direct).not.toBeNull();
      expect(direct!.proxyUrl).toBeNull();
      await pool.close();
    });
  });

  describe("health tracker integration", () => {
    it("retires browser when its proxy is benched", async () => {
      const { factory } = makeFakeFactory();
      const tracker = new ProxyHealthTracker({ failureThreshold: 3, cooldownMs: 1000 });
      const pool = new TieredBrowserPool({
        tiers: [{ tier: "datacenter", proxyUrls: ["http://dc1"] }],
        heroFactory: factory,
        healthTracker: tracker,
        logger: silentLogger,
      });
      await pool.ready;

      for (let i = 0; i < 3; i++) tracker.recordFailure("http://dc1");

      // Event handler schedules retire asynchronously
      await tick(5);

      const browser = pool.getBrowserByProxy("http://dc1")!;
      // retire is fire-and-forget; wait for it to settle
      for (let i = 0; i < 50 && browser.getState() !== "closed"; i++) {
        await tick(1);
      }
      expect(browser.getState()).toBe("closed");

      await pool.close();
    });

    it("relaunches browser when its proxy is revived", async () => {
      const clock = { t: 1_000_000 };
      const { factory } = makeFakeFactory();
      const tracker = new ProxyHealthTracker({
        failureThreshold: 3,
        cooldownMs: 1000,
        now: () => clock.t,
      });
      const pool = new TieredBrowserPool({
        tiers: [{ tier: "datacenter", proxyUrls: ["http://dc1"] }],
        heroFactory: factory,
        healthTracker: tracker,
        logger: silentLogger,
      });
      await pool.ready;
      const browser = pool.getBrowserByProxy("http://dc1")!;

      // Bench
      for (let i = 0; i < 3; i++) tracker.recordFailure("http://dc1");
      await tick(5);
      for (let i = 0; i < 50 && browser.getState() !== "closed"; i++) {
        await tick(1);
      }
      expect(browser.getState()).toBe("closed");

      // Advance the fake clock past the cooldown, then trigger a health
      // check which will emit the revive event.
      clock.t += 2000;
      expect(tracker.isHealthy("http://dc1")).toBe(true);

      // Relaunch happens asynchronously via the event listener
      for (let i = 0; i < 50 && browser.getState() !== "active"; i++) {
        await tick(1);
      }
      expect(browser.getState()).toBe("active");

      await pool.close();
    });

    it("acquire skips benched browsers", async () => {
      const { factory } = makeFakeFactory();
      const tracker = new ProxyHealthTracker({ failureThreshold: 3, cooldownMs: 10000 });
      const pool = new TieredBrowserPool({
        tiers: [
          {
            tier: "datacenter",
            proxyUrls: ["http://dc1", "http://dc2"],
          },
        ],
        heroFactory: factory,
        healthTracker: tracker,
        logger: silentLogger,
      });
      await pool.ready;

      for (let i = 0; i < 3; i++) tracker.recordFailure("http://dc1");
      // Wait for dc1 retirement to settle
      for (let i = 0; i < 50; i++) {
        await tick(1);
        if (pool.getBrowserByProxy("http://dc1")!.getState() === "closed") break;
      }

      // Acquire should now always return dc2
      for (let i = 0; i < 5; i++) {
        const lease = pool.acquire("datacenter");
        expect(lease.browser.proxyUrl).toBe("http://dc2");
      }

      await pool.close();
    });
  });

  describe("close", () => {
    it("retires every browser across every tier", async () => {
      const { factory, instances } = makeFakeFactory();
      const pool = new TieredBrowserPool({
        tiers: [
          { tier: "datacenter", proxyUrls: ["http://dc1", "http://dc2"] },
          { tier: "residential", proxyUrls: ["http://res1"] },
        ],
        heroFactory: factory,
        logger: silentLogger,
      });
      await pool.ready;
      await pool.close();
      expect(instances.every((i) => i.closed)).toBe(true);
    });

    it("is safe to call close() twice", async () => {
      const { factory } = makeFakeFactory();
      const pool = new TieredBrowserPool({
        tiers: [{ tier: "datacenter", proxyUrls: ["http://dc1"] }],
        heroFactory: factory,
        logger: silentLogger,
      });
      await pool.ready;
      await pool.close();
      await pool.close();
    });

    it("acquire throws after close", async () => {
      const { factory } = makeFakeFactory();
      const pool = new TieredBrowserPool({
        tiers: [{ tier: "datacenter", proxyUrls: ["http://dc1"] }],
        heroFactory: factory,
        logger: silentLogger,
      });
      await pool.ready;
      await pool.close();
      expect(() => pool.acquire("datacenter")).toThrow(/closed/);
    });
  });
});

describe("buildTierConfigsFromPools", () => {
  it("returns datacenter + residential when both configured, no direct", () => {
    const tiers = buildTierConfigsFromPools({
      datacenter: [{ url: "http://dc1" }, { url: "http://dc2" }],
      residential: [{ url: "http://res1" }],
    });
    expect(tiers).toHaveLength(2);
    expect(tiers[0]).toEqual({ tier: "datacenter", proxyUrls: ["http://dc1", "http://dc2"] });
    expect(tiers[1]).toEqual({ tier: "residential", proxyUrls: ["http://res1"] });
  });

  it("returns only datacenter when residential is empty", () => {
    const tiers = buildTierConfigsFromPools({
      datacenter: [{ url: "http://dc1" }],
    });
    expect(tiers).toHaveLength(1);
    expect(tiers[0].tier).toBe("datacenter");
  });

  it("returns direct when no proxies configured (default size 1)", () => {
    const tiers = buildTierConfigsFromPools({});
    expect(tiers).toHaveLength(1);
    expect(tiers[0]).toEqual({ tier: "direct", proxyUrls: [null] });
  });

  it("respects directPoolSize when creating direct tier", () => {
    const tiers = buildTierConfigsFromPools({}, { directPoolSize: 3 });
    expect(tiers[0].proxyUrls).toEqual([null, null, null]);
  });

  it("does NOT add a direct tier when any proxy is configured", () => {
    const tiers = buildTierConfigsFromPools({
      datacenter: [{ url: "http://dc1" }],
    });
    expect(tiers.find((t) => t.tier === "direct")).toBeUndefined();
  });

  it("treats undefined pools as empty", () => {
    const tiers = buildTierConfigsFromPools(undefined);
    expect(tiers).toHaveLength(1);
    expect(tiers[0].tier).toBe("direct");
  });

  it("filters out proxies with no URL", () => {
    const tiers = buildTierConfigsFromPools({
      datacenter: [{ url: "http://dc1" }, {}, { url: "" }],
    });
    expect(tiers[0].proxyUrls).toEqual(["http://dc1"]);
  });
});
