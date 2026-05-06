import { describe, it, expect } from "vitest";
import { getDomainProfile, applyDomainProfile } from "../../src/config/domain-profiles";

// Test profiles — reader has no built-in profiles, so we provide our own
const TEST_PROFILES = {
  "amazon.com": { proxyTier: "residential" as const, timeoutMs: 60000, batchConcurrency: 2 },
  "amazon.co.uk": { proxyTier: "residential" as const, timeoutMs: 60000 },
  "amazon.de": { proxyTier: "residential" as const, timeoutMs: 60000 },
  "amazon.co.jp": { proxyTier: "residential" as const, timeoutMs: 60000 },
  "linkedin.com": { proxyTier: "residential" as const, timeoutMs: 60000 },
  "google.com": { batchConcurrency: 1 },
};

describe("getDomainProfile", () => {
  describe("exact domain match", () => {
    it("returns profile for amazon.com", () => {
      const profile = getDomainProfile("amazon.com", TEST_PROFILES);
      expect(profile).toBeDefined();
      expect(profile!.proxyTier).toBe("residential");
      expect(profile!.timeoutMs).toBe(60000);
    });

    it("returns profile for linkedin.com", () => {
      const profile = getDomainProfile("linkedin.com", TEST_PROFILES);
      expect(profile).toBeDefined();
      expect(profile!.proxyTier).toBe("residential");
    });

    it("returns undefined for unknown domain", () => {
      expect(getDomainProfile("example.com", TEST_PROFILES)).toBeUndefined();
    });

    it("returns undefined when no profiles provided", () => {
      expect(getDomainProfile("amazon.com")).toBeUndefined();
      expect(getDomainProfile("amazon.com", undefined)).toBeUndefined();
      expect(getDomainProfile("amazon.com", {})).toBeUndefined();
    });
  });

  describe("www stripping", () => {
    it("strips www. prefix before lookup", () => {
      const profile = getDomainProfile("www.amazon.com", TEST_PROFILES);
      expect(profile).toBeDefined();
      expect(profile!.proxyTier).toBe("residential");
    });
  });

  describe("subdomain matching", () => {
    it("matches shop.amazon.com to amazon.com profile", () => {
      const profile = getDomainProfile("shop.amazon.com", TEST_PROFILES);
      expect(profile).toBeDefined();
      expect(profile!.proxyTier).toBe("residential");
    });

    it("matches smile.amazon.com to amazon.com profile", () => {
      const profile = getDomainProfile("smile.amazon.com", TEST_PROFILES);
      expect(profile).toBeDefined();
    });

    it("does not match amazonclone.com to amazon.com", () => {
      expect(getDomainProfile("amazonclone.com", TEST_PROFILES)).toBeUndefined();
    });
  });

  describe("full URL input", () => {
    it("extracts hostname from full URL", () => {
      const profile = getDomainProfile("https://www.amazon.com/dp/B08N5WRWNW", TEST_PROFILES);
      expect(profile).toBeDefined();
      expect(profile!.proxyTier).toBe("residential");
    });

    it("handles URL with port", () => {
      const profile = getDomainProfile("https://amazon.com:443/dp/B08N5WRWNW", TEST_PROFILES);
      expect(profile).toBeDefined();
    });

    it("returns undefined for invalid URL", () => {
      expect(getDomainProfile("not a url at all", TEST_PROFILES)).toBeUndefined();
    });
  });

  describe("international Amazon domains", () => {
    it("matches amazon.co.uk", () => {
      expect(getDomainProfile("amazon.co.uk", TEST_PROFILES)).toBeDefined();
    });

    it("matches amazon.de", () => {
      expect(getDomainProfile("amazon.de", TEST_PROFILES)).toBeDefined();
    });

    it("matches amazon.co.jp", () => {
      expect(getDomainProfile("amazon.co.jp", TEST_PROFILES)).toBeDefined();
    });
  });
});

describe("applyDomainProfile", () => {
  it("applies profile values when user has not set them", () => {
    const options = { urls: ["https://amazon.com"], formats: ["markdown" as const] };
    const profile = { proxyTier: "residential" as const, timeoutMs: 60000 };
    const merged = applyDomainProfile(options, profile);

    expect(merged.timeoutMs).toBe(60000);
    expect(merged.proxyTier).toBe("residential");
  });

  it("does not override user-provided values", () => {
    const options = { urls: ["https://amazon.com"], timeoutMs: 15000, proxyTier: "datacenter" as const };
    const profile = { proxyTier: "residential" as const, timeoutMs: 60000 };
    const merged = applyDomainProfile(options, profile);

    expect(merged.timeoutMs).toBe(15000);
    expect(merged.proxyTier).toBe("datacenter");
  });

  it("preserves all original options", () => {
    const options = {
      urls: ["https://amazon.com"],
      formats: ["markdown" as const],
      onlyMainContent: true,
      verbose: true,
    };
    const profile = { proxyTier: "residential" as const };
    const merged = applyDomainProfile(options, profile);

    expect(merged.urls).toEqual(["https://amazon.com"]);
    expect(merged.formats).toEqual(["markdown"]);
    expect(merged.onlyMainContent).toBe(true);
    expect(merged.verbose).toBe(true);
  });
});
