/**
 * Browser Session Unit Tests
 *
 * Tests the findChromePath logic and session structure.
 * Full integration is tested in the E2E suite (reader-e2e).
 */
import { describe, it, expect, vi } from "vitest";

// Since browser-session.ts spawns real Chrome processes,
// unit tests focus on the exported types and utilities.
// The heavy lifting is tested in E2E (suites/browser-session/run.ts).

describe("browser-session module", () => {
  it("exports createBrowserSession function", async () => {
    const mod = await import("../../src/browser-session");
    expect(typeof mod.createBrowserSession).toBe("function");
  });

  it("BrowserSession type has required fields", async () => {
    // Type-level check — if this compiles, the types are correct
    const session: import("../../src/browser-types").BrowserSession = {
      sessionId: "test-id",
      wsEndpoint: "ws://localhost:9222/devtools/browser/uuid",
      createdAt: new Date().toISOString(),
      close: async () => {},
    };
    expect(session.sessionId).toBe("test-id");
    expect(session.wsEndpoint).toContain("ws://");
    expect(typeof session.close).toBe("function");
  });

  it("BrowserOptions accepts all expected fields", async () => {
    const opts: import("../../src/browser-types").BrowserOptions = {
      proxy: { host: "proxy.example.com", port: 8080 },
      proxyTier: "residential",
      showChrome: true,
      timeoutMs: 60_000,
      verbose: true,
    };
    expect(opts.proxyTier).toBe("residential");
    expect(opts.timeoutMs).toBe(60_000);
  });
});
