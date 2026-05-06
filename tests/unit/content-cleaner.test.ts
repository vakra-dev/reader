import { describe, it, expect } from "vitest";
import { cleanContent } from "../../src/utils/content-cleaner";

describe("cleanContent", () => {
  describe("script and style removal", () => {
    it("removes script tags", () => {
      const html = `<html><body><script>alert('xss')</script><p>Content</p></body></html>`;
      const result = cleanContent(html, "https://example.com");
      expect(result).not.toContain("<script");
      expect(result).toContain("Content");
    });

    it("removes style tags", () => {
      const html = `<html><body><style>.x { color: red }</style><p>Content</p></body></html>`;
      const result = cleanContent(html, "https://example.com");
      expect(result).not.toContain("<style");
      expect(result).toContain("Content");
    });

    it("removes noscript tags", () => {
      const html = `<html><body><noscript>Enable JS</noscript><p>Content</p></body></html>`;
      const result = cleanContent(html, "https://example.com");
      expect(result).not.toContain("Enable JS");
    });
  });

  describe("onlyMainContent navigation removal", () => {
    it("removes nav, header, footer when onlyMainContent=true", () => {
      const html = `
        <html><body>
          <nav>Navigation links</nav>
          <header>Site header</header>
          <main><p>Main article content here that is long enough to not be filtered</p></main>
          <footer>Footer info</footer>
        </body></html>
      `;
      const result = cleanContent(html, "https://example.com", { onlyMainContent: true });
      expect(result).toContain("Main article content");
      expect(result).not.toContain("Navigation links");
      expect(result).not.toContain("Footer info");
    });

    it("keeps nav, header, footer when onlyMainContent=false", () => {
      const html = `
        <html><body>
          <nav>Navigation links</nav>
          <p>Main content</p>
          <footer>Footer info</footer>
        </body></html>
      `;
      const result = cleanContent(html, "https://example.com", { onlyMainContent: false });
      expect(result).toContain("Navigation links");
      expect(result).toContain("Main content");
      expect(result).toContain("Footer info");
    });

    it("protects #content from removal even if it's inside a removable element", () => {
      const html = `
        <html><body>
          <header>
            <div id="content"><p>This is the real content</p></div>
          </header>
        </body></html>
      `;
      const result = cleanContent(html, "https://example.com", { onlyMainContent: true });
      expect(result).toContain("This is the real content");
    });
  });

  describe("does NOT strip legitimate content", () => {
    it("preserves body with class containing 'dialog' substring", () => {
      // Regression test: Wikipedia's <body class="...uls-dialog-sticky-hide...">
      // was being nuked by the old [class*="dialog"] wildcard selector.
      const html = `
        <html><body class="skin uls-dialog-sticky-hide action-view">
          <div id="content">
            <p>This is the real article content that should survive cleaning.</p>
          </div>
        </body></html>
      `;
      const result = cleanContent(html, "https://en.wikipedia.org/wiki/Test", { onlyMainContent: true });
      expect(result).toContain("real article content");
    });

    it("preserves forms and inputs (they may contain visible text)", () => {
      const html = `
        <html><body>
          <form><label>Search: <input type="text" value="query"></label></form>
          <p>Content</p>
        </body></html>
      `;
      const result = cleanContent(html, "https://example.com", { onlyMainContent: false });
      expect(result).toContain("Search:");
    });

    it("preserves aria-hidden elements (may be re-shown by JS)", () => {
      const html = `
        <html><body>
          <div aria-hidden="true"><p>Hidden but potentially real content</p></div>
          <p>Visible</p>
        </body></html>
      `;
      const result = cleanContent(html, "https://example.com", { onlyMainContent: false });
      expect(result).toContain("Hidden but potentially real content");
    });
  });

  describe("Wikipedia content extraction", () => {
    it("preserves Wikipedia article body through #mw-content-text protection", () => {
      const html = `
        <html><body class="mediawiki uls-dialog-sticky-hide">
          <div id="mw-page-base"></div>
          <nav id="p-personal"><a href="/login">Log in</a></nav>
          <div id="content">
            <h1 id="firstHeading">Web scraping</h1>
            <div id="bodyContent">
              <div id="mw-content-text">
                <p>Web scraping is the process of extracting data from websites. ${"More body text. ".repeat(20)}</p>
                <p>It involves making HTTP requests, parsing HTML, and extracting the content of interest.</p>
              </div>
            </div>
          </div>
          <footer>Wikipedia footer</footer>
        </body></html>
      `;
      const result = cleanContent(html, "https://en.wikipedia.org/wiki/Web_scraping", {
        onlyMainContent: true,
      });
      expect(result).toContain("Web scraping is the process");
      expect(result).toContain("HTTP requests");
      expect(result).not.toContain("Wikipedia footer");
      expect(result).not.toContain("Log in");
    });
  });

  describe("docs.anthropic.com content extraction", () => {
    it("preserves Mintlify-style main.relative content", () => {
      const html = `
        <html><body>
          <nav>Sidebar nav</nav>
          <main class="relative max-w-4xl">
            <h1>Welcome to Claude</h1>
            <p>Claude is an AI assistant. ${"Documentation body text. ".repeat(15)}</p>
            <p>Get started by reading the API reference.</p>
          </main>
          <footer>Doc footer</footer>
        </body></html>
      `;
      const result = cleanContent(html, "https://docs.anthropic.com/en/docs/welcome", {
        onlyMainContent: true,
      });
      expect(result).toContain("Welcome to Claude");
      expect(result).toContain("Documentation body text");
      expect(result).not.toContain("Doc footer");
    });
  });

  describe("selector filtering", () => {
    it("applies excludeTags correctly", () => {
      const html = `
        <html><body>
          <div class="comments">User comments here</div>
          <p>Main content paragraph</p>
        </body></html>
      `;
      const result = cleanContent(html, "https://example.com", {
        excludeTags: [".comments"],
      });
      expect(result).not.toContain("User comments");
      expect(result).toContain("Main content");
    });

    it("applies includeTags correctly", () => {
      const html = `
        <html><body>
          <div class="sidebar">Sidebar</div>
          <div class="article-content">Article text</div>
          <div class="footer">Footer</div>
        </body></html>
      `;
      const result = cleanContent(html, "https://example.com", {
        includeTags: [".article-content"],
      });
      expect(result).toContain("Article text");
    });
  });

  describe("edge cases", () => {
    it("handles empty HTML without crashing", () => {
      // linkedom may throw on truly empty input
      expect(() => cleanContent("", "https://example.com")).toThrow();
    });

    it("handles HTML with only whitespace without crashing", () => {
      expect(() => cleanContent("   \n\t   ", "https://example.com")).toThrow();
    });

    it("handles minimal HTML structure", () => {
      const result = cleanContent("<html><body></body></html>", "https://example.com");
      expect(result).toBeDefined();
    });

    it("preserves text content through cleaning", () => {
      const html = `<html><body><h1>Title</h1><p>Paragraph with <strong>bold</strong> text.</p></body></html>`;
      const result = cleanContent(html, "https://example.com");
      expect(result).toContain("Title");
      expect(result).toContain("bold");
    });
  });

  describe("URL handling", () => {
    it("absolutifies relative URLs", () => {
      const html = `<html><body><a href="/page">Link</a><img src="/img.png"></body></html>`;
      const result = cleanContent(html, "https://example.com");
      expect(result).toContain("https://example.com/page");
      expect(result).toContain("https://example.com/img.png");
    });

    it("resolves srcset to largest image", () => {
      const html = `<html><body><img srcset="small.jpg 200w, large.jpg 800w" src="tiny.jpg"></body></html>`;
      const result = cleanContent(html, "https://example.com");
      // srcset resolves to large.jpg, then URL absolutifier makes it https://example.com/large.jpg
      expect(result).toContain("large.jpg");
      expect(result).not.toContain('src="tiny.jpg"');
    });
  });

  describe("base64 image removal", () => {
    it("removes base64 img elements when removeBase64Images=true", () => {
      const html = `<html><body><img src="data:image/png;base64,abc123"><p>Content</p></body></html>`;
      const result = cleanContent(html, "https://example.com", { removeBase64Images: true });
      expect(result).not.toContain("data:image");
      expect(result).toContain("Content");
    });
  });
});
