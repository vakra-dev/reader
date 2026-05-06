import { describe, it, expect } from "vitest";
import { postprocessMarkdown } from "../../src/formatters/postprocess";

describe("postprocessMarkdown", () => {
  // ── Skip/Jump to Content removal ──────────────────────────────────

  describe("skip to content removal", () => {
    it("removes [Skip to Content](#main)", () => {
      const input = "[Skip to Content](#main)\n\nHello world";
      expect(postprocessMarkdown(input)).toBe("Hello world");
    });

    it("removes [Jump to Content](#content)", () => {
      const input = "[Jump to Content](#content)\n\nHello world";
      expect(postprocessMarkdown(input)).toBe("Hello world");
    });

    it("is case insensitive", () => {
      const input = "[skip to content](#nav)\n\nHello world";
      expect(postprocessMarkdown(input)).toBe("Hello world");
    });

    it("removes [Skip to main Content](#main-content)", () => {
      const input = "[Skip to main Content](#main-content)\n\nBody text";
      expect(postprocessMarkdown(input)).toBe("Body text");
    });

    it("removes [JUMP TO MAIN CONTENT](#top)", () => {
      const input = "[JUMP TO MAIN CONTENT](#top)\n\nBody text";
      expect(postprocessMarkdown(input)).toBe("Body text");
    });

    it("handles various fragment anchors", () => {
      const input = "[Skip to Content](#skip-nav)\n\nContent here";
      expect(postprocessMarkdown(input)).toBe("Content here");
    });

    it("does NOT remove when linking to a real URL (not a fragment)", () => {
      const input = "[Skip to Content](https://example.com/content)\n\nHello";
      expect(postprocessMarkdown(input)).toBe(
        "[Skip to Content](https://example.com/content)\n\nHello",
      );
    });
  });

  // ── Image link deduplication ──────────────────────────────────────

  describe("image link deduplication", () => {
    it("deduplicates when image URL and link URL match", () => {
      const input = "[![alt text](https://img.com/photo.jpg)](https://img.com/photo.jpg)";
      expect(postprocessMarkdown(input)).toBe("![alt text](https://img.com/photo.jpg)");
    });

    it("does NOT deduplicate when URLs differ", () => {
      const input =
        "[![alt text](https://img.com/photo.jpg)](https://example.com/page)";
      expect(postprocessMarkdown(input)).toBe(
        "[![alt text](https://img.com/photo.jpg)](https://example.com/page)",
      );
    });

    it("deduplicates multiple image links in one document", () => {
      const input = [
        "[![a](https://x.com/1.png)](https://x.com/1.png)",
        "[![b](https://x.com/2.png)](https://x.com/2.png)",
      ].join("\n\n");
      const expected = [
        "![a](https://x.com/1.png)",
        "![b](https://x.com/2.png)",
      ].join("\n\n");
      expect(postprocessMarkdown(input)).toBe(expected);
    });
  });

  // ── Blank line collapsing ─────────────────────────────────────────

  describe("blank line collapsing", () => {
    it("collapses 3 consecutive blank lines to 2", () => {
      const input = "Hello\n\n\nWorld";
      expect(postprocessMarkdown(input)).toBe("Hello\n\nWorld");
    });

    it("collapses 5 consecutive blank lines to 2", () => {
      const input = "Hello\n\n\n\n\nWorld";
      expect(postprocessMarkdown(input)).toBe("Hello\n\nWorld");
    });

    it("keeps 2 consecutive newlines as-is", () => {
      const input = "Hello\n\nWorld";
      expect(postprocessMarkdown(input)).toBe("Hello\n\nWorld");
    });
  });

  // ── Trim ──────────────────────────────────────────────────────────

  describe("trim", () => {
    it("trims leading and trailing whitespace", () => {
      const input = "   \n\nHello world\n\n   ";
      expect(postprocessMarkdown(input)).toBe("Hello world");
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles empty input", () => {
      expect(postprocessMarkdown("")).toBe("");
    });
  });

  // ── Combined ──────────────────────────────────────────────────────

  describe("combined patterns", () => {
    it("applies all transformations in one document", () => {
      const input = [
        "  ",
        "[Skip to Content](#main)",
        "",
        "",
        "",
        "",
        "# Title",
        "",
        "[![hero](https://img.com/hero.jpg)](https://img.com/hero.jpg)",
        "",
        "Some content here.",
        "",
        "",
        "",
        "Footer text",
        "  ",
      ].join("\n");

      const expected = [
        "# Title",
        "",
        "![hero](https://img.com/hero.jpg)",
        "",
        "Some content here.",
        "",
        "Footer text",
      ].join("\n");

      expect(postprocessMarkdown(input)).toBe(expected);
    });
  });
});
