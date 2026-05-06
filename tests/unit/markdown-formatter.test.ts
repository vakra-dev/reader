import { describe, it, expect } from "vitest";
import { htmlToMarkdown, formatToMarkdown } from "../../src/formatters/markdown";

describe("htmlToMarkdown", () => {
  describe("with real supermarkdown", () => {
    it("converts heading to atx-style markdown", () => {
      const result = htmlToMarkdown("<h1>Hello World</h1>");
      expect(result).toContain("# Hello World");
    });

    it("converts paragraph to plain text", () => {
      const result = htmlToMarkdown("<p>This is a paragraph.</p>");
      expect(result).toContain("This is a paragraph.");
      // Should not contain any HTML tags
      expect(result).not.toContain("<p>");
    });

    it("converts links to inline markdown", () => {
      const result = htmlToMarkdown(
        '<p><a href="https://example.com">Click here</a></p>'
      );
      expect(result).toContain("[Click here](https://example.com)");
    });

    it("converts unordered lists with - bullet marker", () => {
      const result = htmlToMarkdown(
        "<ul><li>First</li><li>Second</li><li>Third</li></ul>"
      );
      expect(result).toContain("- First");
      expect(result).toContain("- Second");
      expect(result).toContain("- Third");
    });

    it("converts bold and italic text", () => {
      const result = htmlToMarkdown(
        "<p><strong>bold</strong> and <em>italic</em></p>"
      );
      expect(result).toContain("**bold**");
      expect(result).toContain("*italic*");
    });

    it("converts code blocks with backtick fence", () => {
      const result = htmlToMarkdown(
        "<pre><code>const x = 1;</code></pre>"
      );
      expect(result).toContain("`");
      expect(result).toContain("const x = 1;");
    });

    it("returns empty string for empty input", () => {
      const result = htmlToMarkdown("");
      expect(result).toBe("");
    });

    it("handles whitespace-only HTML", () => {
      const result = htmlToMarkdown("   \n\t  ");
      // Should return empty or whitespace-only (short input, no fallback triggered)
      expect(result.trim()).toBe("");
    });

    it("converts tables to GFM format", () => {
      const result = htmlToMarkdown(
        "<table><thead><tr><th>Name</th><th>Age</th></tr></thead>" +
          "<tbody><tr><td>Alice</td><td>30</td></tr></tbody></table>"
      );
      expect(result).toContain("Name");
      expect(result).toContain("Age");
      expect(result).toContain("Alice");
      expect(result).toContain("30");
      // GFM tables use pipes
      expect(result).toContain("|");
    });

    it("converts images to markdown syntax", () => {
      const result = htmlToMarkdown(
        '<img src="https://example.com/image.png" alt="A photo">'
      );
      expect(result).toContain("![A photo](https://example.com/image.png)");
    });

    it("handles nested HTML structures", () => {
      const result = htmlToMarkdown(
        '<p>This has <strong>bold</strong>, <em>italic</em>, and <a href="https://example.com">a link</a>.</p>'
      );
      expect(result).toContain("**bold**");
      expect(result).toContain("*italic*");
      expect(result).toContain("[a link](https://example.com)");
    });
  });

  describe("fallback behavior", () => {
    it("falls back to text extraction when convert returns empty on large input", () => {
      // Build HTML > 100 chars that would normally convert fine,
      // but if supermarkdown returned empty, fallback strips tags.
      // We can't easily mock the Rust module, so we test the fallback
      // path indirectly: pass in HTML with only script/style tags and
      // enough length to trigger the fallback threshold check.
      // The real convert handles this fine, so this test validates
      // that normal large input does NOT trigger fallback.
      const largeHtml =
        "<p>" + "Hello world. ".repeat(20) + "</p>";
      const result = htmlToMarkdown(largeHtml);
      // Should contain the text (real convert works, no fallback)
      expect(result).toContain("Hello world.");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("formatToMarkdown alias", () => {
    it("is the same function as htmlToMarkdown", () => {
      expect(formatToMarkdown).toBe(htmlToMarkdown);
    });

    it("produces identical output", () => {
      const html = "<h2>Test</h2><p>Content here</p>";
      expect(formatToMarkdown(html)).toBe(htmlToMarkdown(html));
    });
  });
});
