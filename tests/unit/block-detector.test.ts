import { describe, it, expect } from "vitest";
import { detectBotPage, detectBotTitle, isBlockedResponse, type BlockDetectionConfig } from "../../src/utils/block-detector";

// Test config — mimics what reader-api would provide
const TEST_CONFIG: BlockDetectionConfig = {
  patterns: [
    /robot check/i,
    /access denied/i,
    /attention required/i,
    /just a moment/i,
    /verify you are a human/i,
    /click the button below to continue shopping/i,
    /to discuss automated access/i,
    /unusual traffic from your computer/i,
    /enable javascript and cookies to continue/i,
    /checking your browser before accessing/i,
    /this process is automatic/i,
    /complete the captcha/i,
  ],
  titlePatterns: [
    /robot check/i,
    /access denied/i,
    /attention required/i,
    /just a moment/i,
    /blocked/i,
    /captcha/i,
  ],
  shortContentThreshold: 500,
  longContentSignalThreshold: 3,
};

describe("detectBotPage", () => {
  it("returns false when no config provided (unopinionated)", () => {
    const html = `<html><body>Click the button below to continue shopping</body></html>`;
    expect(detectBotPage(html)).toBe(false);
    expect(detectBotPage(html, undefined)).toBe(false);
    expect(detectBotPage(html, {})).toBe(false);
  });

  describe("with config: Amazon bot pages", () => {
    it("detects Amazon 'click the button' block page", () => {
      const html = `
        <html><head><title>Amazon.com</title></head>
        <body>
          <div class="a-container">
            <h4>Click the button below to continue shopping</h4>
            © 1996-2025, Amazon.com, Inc.
          </div>
        </body></html>
      `;
      expect(detectBotPage(html, TEST_CONFIG)).toBe(true);
    });

    it("detects Amazon 'automated access' block page", () => {
      const html = `<html><body>To discuss automated access to Amazon data please contact us.</body></html>`;
      expect(detectBotPage(html, TEST_CONFIG)).toBe(true);
    });
  });

  describe("with config: Cloudflare pages", () => {
    it("detects Cloudflare JS challenge", () => {
      const html = `
        <html><head><title>Just a moment...</title></head>
        <body>
          <div>Enable JavaScript and cookies to continue</div>
          <div>Checking your browser before accessing</div>
          <div>This process is automatic.</div>
        </body></html>
      `;
      expect(detectBotPage(html, TEST_CONFIG)).toBe(true);
    });
  });

  describe("legitimate pages (no false positives)", () => {
    it("does not flag a normal news article", () => {
      const html = `
        <html><body>
          <h1>Tech News Today</h1>
          <p>${"Lorem ipsum dolor sit amet. ".repeat(20)}</p>
        </body></html>
      `;
      expect(detectBotPage(html, TEST_CONFIG)).toBe(false);
    });

    it("does not flag an article about bots (needs 3+ signals for long content)", () => {
      const html = `
        <html><body>
          <h1>How Bot Detection Works</h1>
          <p>Modern systems verify you are a human using various challenge mechanisms.
          Understanding these systems is important for web security. ${"Regular content. ".repeat(30)}</p>
        </body></html>
      `;
      expect(detectBotPage(html, TEST_CONFIG)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles empty HTML", () => {
      expect(detectBotPage("", TEST_CONFIG)).toBe(false);
    });

    it("handles whitespace-only HTML", () => {
      expect(detectBotPage("   \n\t  ", TEST_CONFIG)).toBe(false);
    });
  });
});

describe("detectBotTitle", () => {
  it("returns false when no config provided", () => {
    expect(detectBotTitle("Robot Check")).toBe(false);
  });

  it("detects 'Robot Check' title with config", () => {
    expect(detectBotTitle("Robot Check", TEST_CONFIG)).toBe(true);
  });

  it("detects 'Access Denied' title", () => {
    expect(detectBotTitle("Access Denied", TEST_CONFIG)).toBe(true);
  });

  it("does not flag normal titles", () => {
    expect(detectBotTitle("Amazon.com: Best Products", TEST_CONFIG)).toBe(false);
    expect(detectBotTitle("Wikipedia", TEST_CONFIG)).toBe(false);
  });

  it("handles empty title", () => {
    expect(detectBotTitle("", TEST_CONFIG)).toBe(false);
  });
});

describe("isBlockedResponse", () => {
  it("detects HTTP 401/403/429/503 without config (always)", () => {
    expect(isBlockedResponse(401).blocked).toBe(true);
    expect(isBlockedResponse(403).blocked).toBe(true);
    expect(isBlockedResponse(429).blocked).toBe(true);
    expect(isBlockedResponse(503).blocked).toBe(true);
  });

  it("does NOT detect bot page without config", () => {
    const html = `<html><body>Click the button below to continue shopping</body></html>`;
    expect(isBlockedResponse(200, html).blocked).toBe(false);
  });

  it("detects 200 + bot page WITH config", () => {
    const html = `<html><body><h4>Click the button below to continue shopping</h4></body></html>`;
    expect(isBlockedResponse(200, html, TEST_CONFIG).blocked).toBe(true);
    expect(isBlockedResponse(200, html, TEST_CONFIG).reason).toBe("bot_page_detected");
  });

  it("allows 200 with real content", () => {
    const html = `<html><body><h1>Real Page</h1><p>${"Lorem ipsum ".repeat(100)}</p></body></html>`;
    expect(isBlockedResponse(200, html, TEST_CONFIG).blocked).toBe(false);
  });

  it("allows 200 without HTML", () => {
    expect(isBlockedResponse(200).blocked).toBe(false);
  });

  it("allows redirects", () => {
    expect(isBlockedResponse(301).blocked).toBe(false);
    expect(isBlockedResponse(302).blocked).toBe(false);
  });
});
