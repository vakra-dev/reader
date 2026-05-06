import { describe, it, expect } from "vitest";
import { createProxyUrl, parseProxyUrl } from "../../src/proxy/config";

describe("createProxyUrl", () => {
  it("creates URL containing host and port", () => {
    const url = createProxyUrl({ host: "proxy.example.com", port: 8080 });
    expect(url).toContain("proxy.example.com");
    expect(url).toContain("8080");
  });

  it("includes auth credentials when provided", () => {
    const url = createProxyUrl({ host: "proxy.example.com", port: 8080, username: "user", password: "pass" });
    expect(url).toContain("user");
    expect(url).toContain("pass");
    expect(url).toContain("proxy.example.com");
  });

  it("returns direct URL if provided", () => {
    const url = createProxyUrl({ url: "http://custom-proxy:9999" });
    expect(url).toBe("http://custom-proxy:9999");
  });
});

describe("parseProxyUrl", () => {
  it("parses simple proxy URL", () => {
    const result = parseProxyUrl("http://proxy.example.com:8080");
    expect(result.host).toBe("proxy.example.com");
    expect(result.port).toBe(8080);
  });

  it("parses proxy URL with auth", () => {
    const result = parseProxyUrl("http://user:pass@proxy.example.com:8080");
    expect(result.host).toBe("proxy.example.com");
    expect(result.port).toBe(8080);
    expect(result.username).toBe("user");
    expect(result.password).toBe("pass");
  });

  it("handles https proxy URLs", () => {
    const result = parseProxyUrl("https://proxy.example.com:443");
    expect(result.host).toBe("proxy.example.com");
    // Port may be number or undefined depending on implementation
    expect(result.port === 443 || result.port === undefined).toBe(true);
  });
});
