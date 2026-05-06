import { describe, it, expect } from "vitest";
import { verifyProxies, verifyProxiesOrThrow } from "../../src/proxy/verify";
import type { EgressIpFetcher } from "../../src/proxy/verify";

/**
 * Build an injected fetcher that maps proxy URLs -> mocked egress behaviour.
 * Each entry is either a string (the egress IP to return) or an Error
 * (the failure to throw).
 */
function makeFakeFetcher(
  routes: Record<string, string | Error>,
): EgressIpFetcher {
  return async (proxyUrl) => {
    const v = routes[proxyUrl];
    if (v === undefined) {
      throw new Error(`fake fetcher: no route for ${proxyUrl}`);
    }
    if (v instanceof Error) throw v;
    return v;
  };
}

describe("verifyProxies", () => {
  it("returns empty result for undefined pools", async () => {
    const result = await verifyProxies(undefined);
    expect(result).toEqual({ verified: [], failed: [] });
  });

  it("returns empty result for empty pools", async () => {
    const result = await verifyProxies({});
    expect(result.verified).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it("verifies a single datacenter proxy and returns its egress IP", async () => {
    const fetcher = makeFakeFetcher({ "http://dc1": "1.2.3.4" });
    const result = await verifyProxies(
      { datacenter: [{ url: "http://dc1" }] },
      { fetcher },
    );
    expect(result.failed).toEqual([]);
    expect(result.verified).toEqual([
      { proxyUrl: "http://dc1", egressIp: "1.2.3.4", tier: "datacenter" },
    ]);
  });

  it("tags residential proxies with the right tier", async () => {
    const fetcher = makeFakeFetcher({ "http://res1": "5.6.7.8" });
    const result = await verifyProxies(
      { residential: [{ url: "http://res1" }] },
      { fetcher },
    );
    expect(result.verified[0]).toMatchObject({ tier: "residential" });
  });

  it("verifies datacenter and residential pools together", async () => {
    const fetcher = makeFakeFetcher({
      "http://dc1": "1.1.1.1",
      "http://dc2": "2.2.2.2",
      "http://res1": "9.9.9.9",
    });
    const result = await verifyProxies(
      {
        datacenter: [{ url: "http://dc1" }, { url: "http://dc2" }],
        residential: [{ url: "http://res1" }],
      },
      { fetcher },
    );
    expect(result.failed).toEqual([]);
    expect(result.verified).toHaveLength(3);
    const tiers = result.verified.map((v) => v.tier).sort();
    expect(tiers).toEqual(["datacenter", "datacenter", "residential"]);
  });

  it("collects failures alongside successes", async () => {
    const fetcher = makeFakeFetcher({
      "http://dc1": "1.1.1.1",
      "http://dc2": new Error("connection refused"),
      "http://res1": "9.9.9.9",
    });
    const result = await verifyProxies(
      {
        datacenter: [{ url: "http://dc1" }, { url: "http://dc2" }],
        residential: [{ url: "http://res1" }],
      },
      { fetcher },
    );
    expect(result.verified).toHaveLength(2);
    expect(result.failed).toEqual([
      { proxyUrl: "http://dc2", tier: "datacenter", error: "connection refused" },
    ]);
  });

  it("ignores entries without a URL", async () => {
    const fetcher = makeFakeFetcher({ "http://dc1": "1.1.1.1" });
    const result = await verifyProxies(
      { datacenter: [{ url: "http://dc1" }, {}, { url: "" }] },
      { fetcher },
    );
    expect(result.verified).toHaveLength(1);
    expect(result.failed).toEqual([]);
  });
});

describe("verifyProxiesOrThrow", () => {
  it("returns the verified list when everything succeeds", async () => {
    const fetcher = makeFakeFetcher({ "http://dc1": "1.1.1.1" });
    const verified = await verifyProxiesOrThrow(
      { datacenter: [{ url: "http://dc1" }] },
      { fetcher },
    );
    expect(verified).toHaveLength(1);
    expect(verified[0].egressIp).toBe("1.1.1.1");
  });

  it("throws a multi-line error listing every failed proxy", async () => {
    const fetcher = makeFakeFetcher({
      "http://dc1": new Error("EHOSTUNREACH"),
      "http://res1": new Error("HTTP 407 from api.ipify.org"),
    });
    await expect(
      verifyProxiesOrThrow(
        {
          datacenter: [{ url: "http://dc1" }],
          residential: [{ url: "http://res1" }],
        },
        { fetcher },
      ),
    ).rejects.toThrow(/Proxy verification failed for 2 proxy/);
  });

  it("redacts proxy credentials in the error message", async () => {
    const fetcher = makeFakeFetcher({
      "http://user:secret@dc1.example.com:8080": new Error("nope"),
    });
    let captured: string = "";
    try {
      await verifyProxiesOrThrow(
        { datacenter: [{ url: "http://user:secret@dc1.example.com:8080" }] },
        { fetcher },
      );
    } catch (e: unknown) {
      captured = e instanceof Error ? e.message : String(e);
    }
    expect(captured).toMatch(/dc1\.example\.com/);
    expect(captured).not.toContain("secret");
    expect(captured).not.toContain("user:secret");
  });

  it("does not throw when there are zero proxies", async () => {
    const verified = await verifyProxiesOrThrow(undefined);
    expect(verified).toEqual([]);
  });
});
