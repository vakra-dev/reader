import { describe, it, expect } from "vitest";
import { extractMetadata } from "../../src/utils/metadata-extractor";

describe("extractMetadata", () => {
  describe("basic meta tags", () => {
    it("extracts title from <title> tag", () => {
      const html = "<html><head><title>My Page</title></head><body></body></html>";
      const meta = extractMetadata(html, "https://example.com");
      expect(meta.title).toBe("My Page");
    });

    it("extracts description from meta tag", () => {
      const html = '<html><head><meta name="description" content="A great page"></head><body></body></html>';
      const meta = extractMetadata(html, "https://example.com");
      expect(meta.description).toBe("A great page");
    });

    it("extracts language from html lang attribute", () => {
      const html = '<html lang="en"><head></head><body></body></html>';
      const meta = extractMetadata(html, "https://example.com");
      expect(meta.language).toBe("en");
    });

    it("extracts author from meta tag", () => {
      const html = '<html><head><meta name="author" content="John Doe"></head><body></body></html>';
      const meta = extractMetadata(html, "https://example.com");
      expect(meta.author).toBe("John Doe");
    });

    it("extracts canonical URL", () => {
      const html = '<html><head><link rel="canonical" href="https://example.com/canonical"></head><body></body></html>';
      const meta = extractMetadata(html, "https://example.com");
      expect(meta.canonical).toBe("https://example.com/canonical");
    });

    it("extracts favicon", () => {
      const html = '<html><head><link rel="icon" href="/favicon.ico"></head><body></body></html>';
      const meta = extractMetadata(html, "https://example.com");
      expect(meta.favicon).toContain("favicon.ico");
    });
  });

  describe("Open Graph tags", () => {
    it("extracts og:title", () => {
      const html = '<html><head><meta property="og:title" content="OG Title"></head><body></body></html>';
      const meta = extractMetadata(html, "https://example.com");
      expect(meta.openGraph?.title).toBe("OG Title");
    });

    it("extracts og:description", () => {
      const html = '<html><head><meta property="og:description" content="OG Desc"></head><body></body></html>';
      const meta = extractMetadata(html, "https://example.com");
      expect(meta.openGraph?.description).toBe("OG Desc");
    });

    it("extracts og:image", () => {
      const html = '<html><head><meta property="og:image" content="https://example.com/image.jpg"></head><body></body></html>';
      const meta = extractMetadata(html, "https://example.com");
      expect(meta.openGraph?.image).toBe("https://example.com/image.jpg");
    });
  });

  describe("Twitter card tags", () => {
    it("extracts twitter:card", () => {
      const html = '<html><head><meta name="twitter:card" content="summary_large_image"></head><body></body></html>';
      const meta = extractMetadata(html, "https://example.com");
      expect(meta.twitter?.card).toBe("summary_large_image");
    });

    it("extracts twitter:title", () => {
      const html = '<html><head><meta name="twitter:title" content="Tweet Title"></head><body></body></html>';
      const meta = extractMetadata(html, "https://example.com");
      expect(meta.twitter?.title).toBe("Tweet Title");
    });
  });

  describe("edge cases", () => {
    it("handles HTML with no metadata", () => {
      const html = "<html><body><p>Just content</p></body></html>";
      const meta = extractMetadata(html, "https://example.com");
      expect(meta.title).toBeNull();
      expect(meta.description).toBeNull();
    });

    it("handles empty HTML", () => {
      const meta = extractMetadata("", "https://example.com");
      expect(meta).toBeDefined();
      expect(meta.title).toBeNull();
    });

    it("handles malformed HTML", () => {
      const html = "<html><head><title>Unclosed";
      const meta = extractMetadata(html, "https://example.com");
      expect(meta.title).toBe("Unclosed");
    });
  });
});
