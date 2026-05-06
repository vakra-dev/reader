import { describe, it, expect } from "vitest";

/**
 * HTML Size Guard tests.
 *
 * The scraper truncates HTML > MAX_HTML_BYTES before markdown conversion.
 * We test the logic in isolation (the guard is inline in scraper.ts).
 */

const DEFAULT_MAX = 307200; // 300KB

function applyGuard(html: string, maxBytes: number = DEFAULT_MAX): { truncated: boolean; output: string } {
  if (html.length > maxBytes) {
    return { truncated: true, output: html.slice(0, maxBytes) };
  }
  return { truncated: false, output: html };
}

describe("HTML size guard", () => {
  it("passes through HTML under limit unchanged", () => {
    const html = "<p>Short content</p>";
    const result = applyGuard(html);
    expect(result.truncated).toBe(false);
    expect(result.output).toBe(html);
  });

  it("truncates HTML over limit", () => {
    const html = "x".repeat(400000);
    const result = applyGuard(html);
    expect(result.truncated).toBe(true);
    expect(result.output.length).toBe(DEFAULT_MAX);
  });

  it("handles exactly-at-limit HTML", () => {
    const html = "x".repeat(DEFAULT_MAX);
    const result = applyGuard(html);
    expect(result.truncated).toBe(false);
    expect(result.output.length).toBe(DEFAULT_MAX);
  });

  it("handles empty HTML", () => {
    const result = applyGuard("");
    expect(result.truncated).toBe(false);
    expect(result.output).toBe("");
  });

  it("respects custom limit", () => {
    const html = "x".repeat(1000);
    const result = applyGuard(html, 500);
    expect(result.truncated).toBe(true);
    expect(result.output.length).toBe(500);
  });

  it("default limit is 300KB", () => {
    expect(DEFAULT_MAX).toBe(300 * 1024);
  });
});
