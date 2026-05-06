import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { detectBotPage, type BlockDetectionConfig } from "../../src/utils/block-detector";

const FIXTURES_DIR = join(__dirname, "..", "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

const AMAZON_CONFIG: BlockDetectionConfig = {
  patterns: [
    /click the button below to continue shopping/i,
    /to discuss automated access/i,
  ],
  shortContentThreshold: 500,
  longContentSignalThreshold: 3,
};

describe("detectBotPage with real HTML fixtures", () => {
  it("detects real Amazon bot page with config", () => {
    const html = loadFixture("amazon-bot-page.html");
    expect(detectBotPage(html, AMAZON_CONFIG)).toBe(true);
  });

  it("does NOT detect without config (unopinionated)", () => {
    const html = loadFixture("amazon-bot-page.html");
    expect(detectBotPage(html)).toBe(false);
  });
});
