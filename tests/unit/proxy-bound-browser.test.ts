import { describe, it, expect, vi } from "vitest";
import pino from "pino";
import {
  ProxyBoundBrowser,
  redactProxyUrl,
  type HeroFactory,
  type HeroLike,
  type TabLike,
} from "../../src/browser/proxy-bound-browser";

/**
 * Silent logger so tests don't spam stdout.
 */
const silentLogger = pino({ level: "silent" });

/**
 * Fake Tab returned by fake Hero's newTab().
 */
interface FakeTab extends TabLike {
  tabClosed: boolean;
}

function makeFakeTab(): FakeTab {
  return {
    tabClosed: false,
    async goto() { return undefined; },
    get url() { return Promise.resolve("about:blank"); },
    get document() { return {} as unknown; },
    async waitForLoad() {},
    async waitForPaintingStable() {},
    async waitForElement() { return undefined as unknown; },
    async close() { this.tabClosed = true; },
  };
}

/**
 * Fake Hero that records the config it was launched with and optionally
 * delays/throws on close. Good enough for exercising ProxyBoundBrowser
 * without importing @ulixee/hero.
 */
interface FakeHero extends HeroLike {
  config: Record<string, unknown>;
  closed: boolean;
  tabs: FakeTab[];
}

function makeFakeFactory(opts: {
  failOnCreate?: Error;
  slowClose?: number;
  failOnClose?: Error;
} = {}): { factory: HeroFactory; instances: FakeHero[]; createCount: number } {
  const instances: FakeHero[] = [];
  let createCount = 0;
  const factory: HeroFactory = {
    create(config: Record<string, unknown>) {
      createCount++;
      if (opts.failOnCreate) throw opts.failOnCreate;
      const hero: FakeHero = {
        config,
        closed: false,
        tabs: [],
        async newTab() {
          const tab = makeFakeTab();
          this.tabs.push(tab);
          return tab;
        },
        async closeTab(tab: TabLike) {
          await tab.close();
        },
        async close() {
          if (opts.slowClose) {
            await new Promise((r) => setTimeout(r, opts.slowClose));
          }
          if (opts.failOnClose) throw opts.failOnClose;
          this.closed = true;
        },
      };
      instances.push(hero);
      return hero;
    },
  };
  return {
    factory,
    instances,
    get createCount() {
      return createCount;
    },
  };
}

/**
 * Helper: let microtasks run so pLimit can move its queue forward.
 */
async function tick(n = 1) {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

describe("ProxyBoundBrowser", () => {
  describe("construction", () => {
    it("throws on invalid maxTabs", () => {
      const { factory } = makeFakeFactory();
      expect(
        () =>
          new ProxyBoundBrowser({
            proxyUrl: "http://p",
            maxTabs: 0,
            heroFactory: factory,
            logger: silentLogger,
          }),
      ).toThrow();
    });

    it("throws on invalid retireAfterPages", () => {
      const { factory } = makeFakeFactory();
      expect(
        () =>
          new ProxyBoundBrowser({
            proxyUrl: "http://p",
            retireAfterPages: 0,
            heroFactory: factory,
            logger: silentLogger,
          }),
      ).toThrow();
    });

    it("defaults maxTabs=2 and retireAfterPages=100", () => {
      const { factory } = makeFakeFactory();
      const b = new ProxyBoundBrowser({
        proxyUrl: "http://p",
        heroFactory: factory,
        logger: silentLogger,
      });
      expect(b.maxTabs).toBe(2);
      expect(b.retireAfterPages).toBe(100);
    });
  });

  describe("ready gate", () => {
    it("resolves once Hero is launched", async () => {
      const { factory, instances } = makeFakeFactory();
      const b = new ProxyBoundBrowser({
        proxyUrl: "http://p",
        heroFactory: factory,
        logger: silentLogger,
      });
      await b.ready;
      expect(b.getState()).toBe("active");
      expect(instances).toHaveLength(1);
    });

    it("rejects if Hero construction throws", async () => {
      const err = new Error("launch boom");
      const { factory } = makeFakeFactory({ failOnCreate: err });
      const b = new ProxyBoundBrowser({
        proxyUrl: "http://p",
        heroFactory: factory,
        logger: silentLogger,
      });
      await expect(b.ready).rejects.toThrow("launch boom");
      expect(b.getState()).toBe("closed");
    });
  });

  describe("proxy binding", () => {
    it("burns the proxy URL into the Hero config", async () => {
      const { factory, instances } = makeFakeFactory();
      const url = "http://user:pass@dc1.example.com:8080";
      const b = new ProxyBoundBrowser({
        proxyUrl: url,
        heroFactory: factory,
        logger: silentLogger,
      });
      await b.ready;
      expect(instances[0].config.upstreamProxyUrl).toBe(url);
    });

    it("sets no upstream proxy for the direct lane", async () => {
      const { factory, instances } = makeFakeFactory();
      const b = new ProxyBoundBrowser({
        proxyUrl: null,
        heroFactory: factory,
        logger: silentLogger,
      });
      await b.ready;
      expect(instances[0].config.upstreamProxyUrl).toBeUndefined();
    });

    it("stable UA across browsers with the same proxy URL", async () => {
      const { factory, instances } = makeFakeFactory();
      const url = "http://x:y@host:1";
      const a = new ProxyBoundBrowser({
        proxyUrl: url,
        heroFactory: factory,
        logger: silentLogger,
      });
      const b = new ProxyBoundBrowser({
        proxyUrl: url,
        heroFactory: factory,
        logger: silentLogger,
      });
      await Promise.all([a.ready, b.ready]);
      expect(instances[0].config.userAgent).toBe(instances[1].config.userAgent);
    });
  });

  describe("withPage tab limiting", () => {
    it("serializes beyond maxTabs", async () => {
      const { factory } = makeFakeFactory();
      const b = new ProxyBoundBrowser({
        proxyUrl: "http://p",
        maxTabs: 2,
        heroFactory: factory,
        logger: silentLogger,
      });
      await b.ready;

      let active = 0;
      let peak = 0;
      const observe = async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      };

      await Promise.all([
        b.withPage(async () => { await observe(); }),
        b.withPage(async () => { await observe(); }),
        b.withPage(async () => { await observe(); }),
        b.withPage(async () => { await observe(); }),
        b.withPage(async () => { await observe(); }),
      ]);

      expect(peak).toBeLessThanOrEqual(2);
    });

    it("increments totalPages on every withPage completion", async () => {
      const { factory } = makeFakeFactory();
      const b = new ProxyBoundBrowser({
        proxyUrl: "http://p",
        heroFactory: factory,
        logger: silentLogger,
      });
      await b.ready;
      await b.withPage(async () => 1);
      await b.withPage(async () => 2);
      await b.withPage(async () => 3);
      expect(b.getStats().totalPages).toBe(3);
    });

    it("increments totalPages even on error", async () => {
      const { factory } = makeFakeFactory();
      const b = new ProxyBoundBrowser({
        proxyUrl: "http://p",
        heroFactory: factory,
        logger: silentLogger,
      });
      await b.ready;
      await expect(
        b.withPage(async () => {
          throw new Error("nope");
        }),
      ).rejects.toThrow("nope");
      expect(b.getStats().totalPages).toBe(1);
    });
  });

  describe("retirement draining", () => {
    it("waits for in-flight tabs to finish before closing", async () => {
      const { factory, instances } = makeFakeFactory();
      const b = new ProxyBoundBrowser({
        proxyUrl: "http://p",
        maxTabs: 2,
        heroFactory: factory,
        logger: silentLogger,
      });
      await b.ready;

      let inFlightResolve!: () => void;
      const inFlight = new Promise<void>((r) => (inFlightResolve = r));

      const page = b.withPage(async () => {
        await inFlight;
        return "done";
      });

      await tick(2);
      // Retire while a tab is in flight. Should not close the Hero yet.
      const retirePromise = b.retire();
      await tick(2);
      expect(instances[0].closed).toBe(false);
      expect(b.getState()).toBe("retired");

      inFlightResolve();
      await page;
      await retirePromise;

      expect(instances[0].closed).toBe(true);
      expect(b.getState()).toBe("closed");
    });

    it("rejects new withPage calls once retired", async () => {
      const { factory } = makeFakeFactory();
      const b = new ProxyBoundBrowser({
        proxyUrl: "http://p",
        heroFactory: factory,
        logger: silentLogger,
      });
      await b.ready;
      await b.retire();
      await expect(b.withPage(async () => 1)).rejects.toThrow(/retired|closed/);
    });

    it("is safe to call retire multiple times", async () => {
      const { factory, instances } = makeFakeFactory();
      const b = new ProxyBoundBrowser({
        proxyUrl: "http://p",
        heroFactory: factory,
        logger: silentLogger,
      });
      await b.ready;
      await Promise.all([b.retire(), b.retire(), b.retire()]);
      expect(instances[0].closed).toBe(true);
    });

    it("swallows close errors during retire", async () => {
      const { factory } = makeFakeFactory({
        failOnClose: new Error("close boom"),
      });
      const b = new ProxyBoundBrowser({
        proxyUrl: "http://p",
        heroFactory: factory,
        logger: silentLogger,
      });
      await b.ready;
      // Should not throw
      await b.retire();
      expect(b.getState()).toBe("closed");
    });
  });

  describe("relaunch", () => {
    it("closes current Hero and launches a fresh one with the same proxy", async () => {
      const fakeFactory = makeFakeFactory();
      const b = new ProxyBoundBrowser({
        proxyUrl: "http://p",
        heroFactory: fakeFactory.factory,
        logger: silentLogger,
      });
      await b.ready;
      expect(fakeFactory.createCount).toBe(1);

      await b.relaunch();
      expect(fakeFactory.createCount).toBe(2);
      expect(fakeFactory.instances[0].closed).toBe(true);
      expect(b.getState()).toBe("active");
      expect(b.getStats().totalPages).toBe(0);
    });

    it("accepts withPage after relaunch", async () => {
      const { factory } = makeFakeFactory();
      const b = new ProxyBoundBrowser({
        proxyUrl: "http://p",
        heroFactory: factory,
        logger: silentLogger,
      });
      await b.ready;
      await b.relaunch();
      const result = await b.withPage(async () => "ok");
      expect(result).toBe("ok");
    });
  });

  describe("auto-recycle after retireAfterPages", () => {
    it("relaunches after hitting the threshold", async () => {
      const fakeFactory = makeFakeFactory();
      const b = new ProxyBoundBrowser({
        proxyUrl: "http://p",
        retireAfterPages: 3,
        heroFactory: fakeFactory.factory,
        logger: silentLogger,
      });
      await b.ready;

      await b.withPage(async () => 1);
      await b.withPage(async () => 2);
      await b.withPage(async () => 3);

      // Recycle is scheduled via setImmediate inside the 3rd withPage's
      // finally. Poll briefly for the state machine to settle into the new
      // `active` state with a freshly-launched Hero.
      for (let i = 0; i < 50 && fakeFactory.createCount < 2; i++) {
        await tick(1);
      }
      await b.ready;

      expect(fakeFactory.createCount).toBe(2);
      expect(b.getState()).toBe("active");
      expect(b.getStats().totalPages).toBe(0);
    });
  });

  describe("stats", () => {
    it("reports state, activeTabs, totalPages, fingerprintIndex", async () => {
      const { factory } = makeFakeFactory();
      const b = new ProxyBoundBrowser({
        proxyUrl: "http://p",
        heroFactory: factory,
        logger: silentLogger,
      });
      await b.ready;
      const s = b.getStats();
      expect(s.state).toBe("active");
      expect(s.activeTabs).toBe(0);
      expect(s.totalPages).toBe(0);
      expect(s.fingerprintIndex).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("redactProxyUrl", () => {
  it("strips credentials but keeps host", () => {
    expect(redactProxyUrl("http://user:pass@host:8080")).toBe("http://***@host:8080");
  });

  it("returns 'direct' for null", () => {
    expect(redactProxyUrl(null)).toBe("direct");
  });

  it("handles URLs without credentials", () => {
    expect(redactProxyUrl("http://host:8080")).toBe("http://host:8080");
  });

  it("returns a safe placeholder for malformed URLs", () => {
    expect(redactProxyUrl("not a url")).toBe("<invalid-proxy-url>");
  });
});
