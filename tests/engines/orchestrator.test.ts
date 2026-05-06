import { describe, it, expect } from "vitest";
import { EngineOrchestrator } from "../../src/engines/orchestrator";
import { ScrapeFailedError, HttpError } from "../../src/engines/errors";
import type { EngineResult } from "../../src/engines/types";
import type { ScrapeOptions } from "../../src/types";

function createMeta(url = "https://example.com") {
  return {
    url,
    options: { urls: [url] } as ScrapeOptions,
  };
}

describe("EngineOrchestrator", () => {
  describe("quality assessment", () => {
    it("passes content with sufficient length and good status", () => {
      const orchestrator = new EngineOrchestrator();
      const result: EngineResult = {
        html: `<html><body><p>${"Real content. ".repeat(20)}</p></body></html>`,
        url: "https://example.com",
        statusCode: 200,
        engine: "hero",
        duration: 100,
      };

      const quality = (orchestrator as any).assessQuality(result);
      expect(quality.passed).toBe(true);
    });

    it("passes bot pages with content (quality gate is minimal)", () => {
      const orchestrator = new EngineOrchestrator();
      const result: EngineResult = {
        html: '<html><body><h4>Click the button below to continue shopping</h4></body></html>',
        url: "https://amazon.com/dp/123",
        statusCode: 200,
        engine: "hero",
        duration: 50,
      };

      const quality = (orchestrator as any).assessQuality(result);
      expect(quality.passed).toBe(true);
    });

    it("fails empty content with good status", () => {
      const orchestrator = new EngineOrchestrator();
      const result: EngineResult = {
        html: "<html><body></body></html>",
        url: "https://example.com",
        statusCode: 200,
        engine: "hero",
        duration: 50,
      };

      const quality = (orchestrator as any).assessQuality(result);
      expect(quality.passed).toBe(false);
      expect(quality.reason).toBe("empty_content");
    });

    it("fails on HTTP error with empty content", () => {
      const orchestrator = new EngineOrchestrator();
      const result: EngineResult = {
        html: "",
        url: "https://example.com",
        statusCode: 500,
        engine: "hero",
        duration: 50,
      };

      const quality = (orchestrator as any).assessQuality(result);
      expect(quality.passed).toBe(false);
      expect(quality.reason).toBe("http_error");
    });
  });

  describe("ScrapeFailedError", () => {
    it("has correct structure with proxyBlock=false", () => {
      const inner = new Error("timeout");
      const err = new ScrapeFailedError(inner);

      expect(err.name).toBe("ScrapeFailedError");
      expect(err.proxyBlock).toBe(false);
      expect(err.message).toBe("timeout");
      expect(err.cause).toBe(inner);
    });

    it("has correct structure with proxyBlock=true", () => {
      const inner = new HttpError("hero", 403, "Forbidden");
      const err = new ScrapeFailedError(inner, { proxyBlock: true });

      expect(err.name).toBe("ScrapeFailedError");
      expect(err.proxyBlock).toBe(true);
      expect(err.message).toContain("403");
    });

    it("defaults proxyBlock to false", () => {
      const err = new ScrapeFailedError(new Error("something"));
      expect(err.proxyBlock).toBe(false);
    });
  });
});
