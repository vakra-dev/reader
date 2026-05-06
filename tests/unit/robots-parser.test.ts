import { describe, it, expect } from "vitest";
import {
  parseRobotsTxt,
  isPathAllowed,
  isUrlAllowed,
  type RobotsRules,
} from "../../src/utils/robots-parser";

describe("parseRobotsTxt", () => {
  it("should parse a basic disallow rule", () => {
    const content = `User-agent: *\nDisallow: /private`;
    const rules = parseRobotsTxt(content);
    expect(rules.disallowedPaths).toEqual(["/private"]);
    expect(rules.allowedPaths).toEqual([]);
    expect(rules.crawlDelay).toBeNull();
  });

  it("should parse multiple disallow rules", () => {
    const content = `User-agent: *\nDisallow: /private\nDisallow: /admin\nDisallow: /secret`;
    const rules = parseRobotsTxt(content);
    expect(rules.disallowedPaths).toEqual(["/private", "/admin", "/secret"]);
  });

  it("should parse allow rules alongside disallow rules", () => {
    const content = `User-agent: *\nDisallow: /private\nAllow: /private/public`;
    const rules = parseRobotsTxt(content);
    expect(rules.disallowedPaths).toEqual(["/private"]);
    expect(rules.allowedPaths).toEqual(["/private/public"]);
  });

  it("should parse crawl-delay and convert to milliseconds", () => {
    const content = `User-agent: *\nCrawl-delay: 2`;
    const rules = parseRobotsTxt(content);
    expect(rules.crawlDelay).toBe(2000);
  });

  it("should parse fractional crawl-delay", () => {
    const content = `User-agent: *\nCrawl-delay: 0.5`;
    const rules = parseRobotsTxt(content);
    expect(rules.crawlDelay).toBe(500);
  });

  it("should match a specific user agent", () => {
    const content = `User-agent: Googlebot\nDisallow: /no-google\n\nUser-agent: *\nDisallow: /no-all`;
    const rules = parseRobotsTxt(content, "Googlebot");
    expect(rules.disallowedPaths).toContain("/no-google");
    expect(rules.disallowedPaths).toContain("/no-all");
  });

  it("should match user agent case-insensitively", () => {
    const content = `User-agent: MyBot\nDisallow: /blocked`;
    const rules = parseRobotsTxt(content, "mybot");
    expect(rules.disallowedPaths).toEqual(["/blocked"]);
  });

  it("should only collect rules under matching user agent sections", () => {
    const content = `User-agent: OtherBot\nDisallow: /other-only\n\nUser-agent: *\nDisallow: /all`;
    const rules = parseRobotsTxt(content, "MyBot");
    expect(rules.disallowedPaths).not.toContain("/other-only");
    expect(rules.disallowedPaths).toContain("/all");
  });

  it("should use wildcard agent by default", () => {
    const content = `User-agent: *\nDisallow: /blocked`;
    const rules = parseRobotsTxt(content);
    expect(rules.disallowedPaths).toEqual(["/blocked"]);
  });

  it("should ignore comments", () => {
    const content = `# This is a comment\nUser-agent: *\n# Another comment\nDisallow: /private`;
    const rules = parseRobotsTxt(content);
    expect(rules.disallowedPaths).toEqual(["/private"]);
  });

  it("should ignore empty lines", () => {
    const content = `\nUser-agent: *\n\n\nDisallow: /private\n\n`;
    const rules = parseRobotsTxt(content);
    expect(rules.disallowedPaths).toEqual(["/private"]);
  });

  it("should return empty rules for empty content", () => {
    const rules = parseRobotsTxt("");
    expect(rules.disallowedPaths).toEqual([]);
    expect(rules.allowedPaths).toEqual([]);
    expect(rules.crawlDelay).toBeNull();
  });

  it("should ignore lines without a colon", () => {
    const content = `User-agent: *\nThis is not a directive\nDisallow: /private`;
    const rules = parseRobotsTxt(content);
    expect(rules.disallowedPaths).toEqual(["/private"]);
  });

  it("should skip empty Disallow values", () => {
    const content = `User-agent: *\nDisallow:\nDisallow: /private`;
    const rules = parseRobotsTxt(content);
    expect(rules.disallowedPaths).toEqual(["/private"]);
  });

  it("should ignore non-numeric crawl-delay", () => {
    const content = `User-agent: *\nCrawl-delay: abc`;
    const rules = parseRobotsTxt(content);
    expect(rules.crawlDelay).toBeNull();
  });
});

describe("isPathAllowed", () => {
  it("should disallow an exact path match", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/private"],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isPathAllowed("/private", rules)).toBe(false);
  });

  it("should disallow a prefix match", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/private"],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isPathAllowed("/private/secret", rules)).toBe(false);
  });

  it("should allow paths that do not match any disallow rule", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/private"],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isPathAllowed("/public", rules)).toBe(true);
  });

  it("should handle wildcard patterns", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/private/*"],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isPathAllowed("/private/foo", rules)).toBe(false);
    expect(isPathAllowed("/private/bar/baz", rules)).toBe(false);
  });

  it("should handle $ end anchor", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/*.pdf$"],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isPathAllowed("/document.pdf", rules)).toBe(false);
    expect(isPathAllowed("/document.pdf?id=1", rules)).toBe(true);
  });

  it("should give allow precedence over disallow", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/private"],
      allowedPaths: ["/private/public"],
      crawlDelay: null,
    };
    expect(isPathAllowed("/private/public", rules)).toBe(true);
    expect(isPathAllowed("/private/secret", rules)).toBe(false);
  });

  it("should default to allowed when no rules match", () => {
    const rules: RobotsRules = {
      disallowedPaths: [],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isPathAllowed("/anything", rules)).toBe(true);
  });

  it("should normalize paths without leading slash", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/private"],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isPathAllowed("private", rules)).toBe(false);
  });

  it("should handle wildcard in the middle of a pattern", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/api/*/internal"],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isPathAllowed("/api/v1/internal", rules)).toBe(false);
    expect(isPathAllowed("/api/v2/internal", rules)).toBe(false);
    expect(isPathAllowed("/api/v1/public", rules)).toBe(true);
  });
});

describe("isUrlAllowed", () => {
  it("should return true when rules are null", () => {
    expect(isUrlAllowed("https://example.com/anything", null)).toBe(true);
  });

  it("should check the pathname of a full URL", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/private"],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isUrlAllowed("https://example.com/private", rules)).toBe(false);
    expect(isUrlAllowed("https://example.com/public", rules)).toBe(true);
  });

  it("should include query string in path matching", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/search?q=blocked"],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isUrlAllowed("https://example.com/search?q=blocked", rules)).toBe(false);
    expect(isUrlAllowed("https://example.com/search?q=allowed", rules)).toBe(true);
  });

  it("should return true for an invalid URL", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/private"],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isUrlAllowed("not-a-valid-url", rules)).toBe(true);
  });

  it("should handle URLs with paths and fragments", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/private"],
      allowedPaths: [],
      crawlDelay: null,
    };
    // Fragments are not sent to the server, URL constructor excludes them from pathname+search
    expect(isUrlAllowed("https://example.com/private#section", rules)).toBe(false);
  });
});
