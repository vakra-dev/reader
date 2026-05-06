import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { detectBotPage, detectBotTitle, type BlockDetectionConfig } from "../../src/utils/block-detector";

const FIXTURES_DIR = join(__dirname, "..", "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

const CF_CONFIG: BlockDetectionConfig = {
  patterns: [
    /just a moment/i,
    /enable javascript and cookies to continue/i,
    /checking your browser before accessing/i,
    /this process is automatic/i,
  ],
  titlePatterns: [/just a moment/i],
  shortContentThreshold: 500,
  longContentSignalThreshold: 3,
};

describe("detectBotPage with Cloudflare fixture", () => {
  it("detects real Cloudflare challenge page when config provided", () => {
    const html = loadFixture("cloudflare-challenge.html");
    expect(detectBotPage(html, CF_CONFIG)).toBe(true);
  });

  it("does NOT detect without config (unopinionated)", () => {
    const html = loadFixture("cloudflare-challenge.html");
    expect(detectBotPage(html)).toBe(false);
  });
});

describe("detectBotTitle with Cloudflare fixture", () => {
  it("detects 'Just a moment...' title with config", () => {
    expect(detectBotTitle("Just a moment...", CF_CONFIG)).toBe(true);
  });
});

describe("detectBotPage with simple static page", () => {
  it("does NOT flag a normal static page", () => {
    const html = loadFixture("simple-static.html");
    expect(detectBotPage(html, CF_CONFIG)).toBe(false);
  });
});

describe("detectBotPage with empty page", () => {
  it("does NOT flag an empty page", () => {
    const html = loadFixture("empty-page.html");
    expect(detectBotPage(html, CF_CONFIG)).toBe(false);
  });
});
