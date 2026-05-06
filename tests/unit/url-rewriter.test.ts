import { describe, it, expect } from "vitest";
import { rewriteUrl, type UrlRewriteRule } from "../../src/utils/url-rewriter";

// Google rewrite rules — mimics what reader-api would provide
function extractGoogleDocId(pathname: string): string | null {
  const match = pathname.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

const GOOGLE_RULES: UrlRewriteRule[] = [
  {
    name: "google-docs",
    match: (url) => url.hostname === "docs.google.com" && url.pathname.startsWith("/document/"),
    rewrite: (url) => {
      const id = extractGoogleDocId(url.pathname);
      return `https://docs.google.com/document/d/${id}/export?format=html`;
    },
  },
  {
    name: "google-sheets",
    match: (url) => url.hostname === "docs.google.com" && url.pathname.startsWith("/spreadsheets/"),
    rewrite: (url) => {
      const id = extractGoogleDocId(url.pathname);
      return `https://docs.google.com/spreadsheets/d/${id}/export?format=html`;
    },
  },
  {
    name: "google-slides",
    match: (url) => url.hostname === "docs.google.com" && url.pathname.startsWith("/presentation/"),
    rewrite: (url) => {
      const id = extractGoogleDocId(url.pathname);
      return `https://docs.google.com/presentation/d/${id}/export/html`;
    },
  },
  {
    name: "google-drive",
    match: (url) => url.hostname === "drive.google.com" && url.pathname.startsWith("/file/"),
    rewrite: (url) => {
      const id = extractGoogleDocId(url.pathname);
      return `https://drive.google.com/uc?id=${id}&export=download`;
    },
  },
];

describe("rewriteUrl", () => {
  it("returns unchanged when no rules provided (unopinionated)", () => {
    const result = rewriteUrl("https://docs.google.com/document/d/abc123/edit");
    expect(result.rewritten).toBe(false);
    expect(result.url).toBe("https://docs.google.com/document/d/abc123/edit");
  });

  describe("Google Docs", () => {
    it("rewrites a Google Docs /edit URL to HTML export", () => {
      const result = rewriteUrl(
        "https://docs.google.com/document/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/edit",
        GOOGLE_RULES,
      );
      expect(result).toEqual({
        url: "https://docs.google.com/document/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/export?format=html",
        rewritten: true,
        reason: "google-docs",
      });
    });

    it("handles document IDs with hyphens and underscores", () => {
      const result = rewriteUrl(
        "https://docs.google.com/document/d/abc-123_DEF-456_ghi/edit",
        GOOGLE_RULES,
      );
      expect(result.rewritten).toBe(true);
      expect(result.reason).toBe("google-docs");
    });
  });

  describe("Google Sheets", () => {
    it("rewrites a Google Sheets URL to HTML export", () => {
      const result = rewriteUrl(
        "https://docs.google.com/spreadsheets/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/edit",
        GOOGLE_RULES,
      );
      expect(result.rewritten).toBe(true);
      expect(result.reason).toBe("google-sheets");
    });
  });

  describe("Google Slides", () => {
    it("rewrites a Google Slides URL to HTML export", () => {
      const result = rewriteUrl(
        "https://docs.google.com/presentation/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/edit",
        GOOGLE_RULES,
      );
      expect(result.rewritten).toBe(true);
      expect(result.reason).toBe("google-slides");
    });
  });

  describe("Google Drive", () => {
    it("rewrites a Google Drive file URL to direct download", () => {
      const result = rewriteUrl(
        "https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/view",
        GOOGLE_RULES,
      );
      expect(result.rewritten).toBe(true);
      expect(result.reason).toBe("google-drive");
    });
  });

  describe("non-matching URLs", () => {
    it("returns non-Google URLs unchanged", () => {
      const result = rewriteUrl("https://example.com/some-page", GOOGLE_RULES);
      expect(result.rewritten).toBe(false);
    });

    it("returns invalid URLs unchanged", () => {
      const result = rewriteUrl("not-a-valid-url", GOOGLE_RULES);
      expect(result.rewritten).toBe(false);
    });

    it("does not rewrite Google Docs non-document paths like /forms/", () => {
      const result = rewriteUrl(
        "https://docs.google.com/forms/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/edit",
        GOOGLE_RULES,
      );
      expect(result.rewritten).toBe(false);
    });
  });
});
