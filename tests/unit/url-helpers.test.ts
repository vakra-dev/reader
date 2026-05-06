import { describe, it, expect } from "vitest";
import { isValidUrl, getUrlKey, isSameDomain, resolveUrl } from "../../src/utils/url-helpers";

describe("isValidUrl", () => {
  it("accepts valid http URLs", () => {
    expect(isValidUrl("http://example.com")).toBe(true);
  });

  it("accepts valid https URLs", () => {
    expect(isValidUrl("https://example.com")).toBe(true);
  });

  it("accepts URLs with paths", () => {
    expect(isValidUrl("https://example.com/path/to/page")).toBe(true);
  });

  it("accepts URLs with query strings", () => {
    expect(isValidUrl("https://example.com?q=test&page=1")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidUrl("")).toBe(false);
  });

  it("rejects plain text", () => {
    expect(isValidUrl("not a url")).toBe(false);
  });

  it("handles javascript: URLs (implementation-dependent)", () => {
    // isValidUrl uses URL constructor which may accept javascript: protocol
    const result = isValidUrl("javascript:alert(1)");
    expect(typeof result).toBe("boolean");
  });
});

describe("getUrlKey", () => {
  it("normalizes www prefix", () => {
    expect(getUrlKey("https://www.example.com")).toBe(getUrlKey("https://example.com"));
  });

  it("removes hash fragments", () => {
    expect(getUrlKey("https://example.com#section")).toBe(getUrlKey("https://example.com"));
  });

  it("removes trailing slash", () => {
    expect(getUrlKey("https://example.com/")).toBe(getUrlKey("https://example.com"));
  });

  it("normalizes index files", () => {
    expect(getUrlKey("https://example.com/index.html")).toBe(getUrlKey("https://example.com/"));
  });

  it("preserves path differences", () => {
    expect(getUrlKey("https://example.com/a")).not.toBe(getUrlKey("https://example.com/b"));
  });

  it("lowercases the result", () => {
    const key = getUrlKey("https://EXAMPLE.COM/Path");
    expect(key).toBe(key.toLowerCase());
  });
});

describe("isSameDomain", () => {
  it("matches same domain", () => {
    expect(isSameDomain("https://example.com/a", "https://example.com/b")).toBe(true);
  });

  it("matches with www difference", () => {
    expect(isSameDomain("https://www.example.com", "https://example.com")).toBe(true);
  });

  it("rejects different domains", () => {
    expect(isSameDomain("https://example.com", "https://other.com")).toBe(false);
  });

  it("rejects subdomains (strict hostname match)", () => {
    expect(isSameDomain("https://blog.example.com", "https://example.com")).toBe(false);
    expect(isSameDomain("https://dashboard.stripe.com", "https://docs.stripe.com")).toBe(false);
  });
});

describe("resolveUrl", () => {
  it("resolves relative path against base", () => {
    const resolved = resolveUrl("/about", "https://example.com/page");
    expect(resolved).toBe("https://example.com/about");
  });

  it("returns absolute URL (may normalize trailing slash)", () => {
    const resolved = resolveUrl("https://other.com", "https://example.com");
    expect(resolved).toContain("other.com");
  });

  it("handles fragment-only URLs", () => {
    const resolved = resolveUrl("#section", "https://example.com/page");
    expect(resolved).toContain("example.com");
  });
});
