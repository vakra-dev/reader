/**
 * Simple robots.txt parser for crawler compliance
 */

export interface RobotsRules {
  disallowedPaths: string[];
  allowedPaths: string[];
  crawlDelay: number | null;
}

/**
 * Parse robots.txt content and extract rules for a specific user agent
 */
export function parseRobotsTxt(content: string, userAgent: string = "*"): RobotsRules {
  const rules: RobotsRules = {
    disallowedPaths: [],
    allowedPaths: [],
    crawlDelay: null,
  };

  const lines = content.split("\n").map((line) => line.trim());
  let currentUserAgent = "";
  let matchesUserAgent = false;

  for (const line of lines) {
    // Skip empty lines and comments
    if (!line || line.startsWith("#")) {
      continue;
    }

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }

    const directive = line.substring(0, colonIndex).trim().toLowerCase();
    const value = line.substring(colonIndex + 1).trim();

    if (directive === "user-agent") {
      currentUserAgent = value.toLowerCase();
      // Match specific user agent or wildcard
      matchesUserAgent = currentUserAgent === "*" || currentUserAgent === userAgent.toLowerCase();
    } else if (matchesUserAgent) {
      if (directive === "disallow" && value) {
        rules.disallowedPaths.push(value);
      } else if (directive === "allow" && value) {
        rules.allowedPaths.push(value);
      } else if (directive === "crawl-delay") {
        const delay = parseFloat(value);
        if (!isNaN(delay)) {
          rules.crawlDelay = delay * 1000; // Convert to milliseconds
        }
      }
    }
  }

  return rules;
}

/**
 * Check if a URL path is allowed by robots.txt rules
 */
export function isPathAllowed(path: string, rules: RobotsRules): boolean {
  // Normalize path
  const normalizedPath = path.startsWith("/") ? path : "/" + path;

  // Check allow rules first (they take precedence)
  for (const allowedPath of rules.allowedPaths) {
    if (pathMatches(normalizedPath, allowedPath)) {
      return true;
    }
  }

  // Check disallow rules
  for (const disallowedPath of rules.disallowedPaths) {
    if (pathMatches(normalizedPath, disallowedPath)) {
      return false;
    }
  }

  // Default: allowed
  return true;
}

/**
 * Check if a path matches a robots.txt pattern
 * Supports * (wildcard) and $ (end anchor)
 */
function pathMatches(path: string, pattern: string): boolean {
  // Empty pattern matches nothing
  if (!pattern) {
    return false;
  }

  // Convert robots.txt pattern to regex
  let regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&") // Escape regex special chars except * and $
    .replace(/\*/g, ".*"); // * becomes .*

  // Handle $ end anchor
  if (regexPattern.endsWith("\\$")) {
    regexPattern = regexPattern.slice(0, -2) + "$";
  } else {
    regexPattern = "^" + regexPattern;
  }

  try {
    const regex = new RegExp(regexPattern);
    return regex.test(path);
  } catch {
    // Invalid pattern, treat as literal prefix match
    return path.startsWith(pattern);
  }
}

/**
 * Fetch and parse robots.txt for a given base URL
 */
export async function fetchRobotsTxt(baseUrl: string): Promise<RobotsRules | null> {
  try {
    const url = new URL("/robots.txt", baseUrl);
    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "ReaderEngine/1.0",
      },
    });

    if (!response.ok) {
      // No robots.txt or error - allow everything
      return null;
    }

    const content = await response.text();
    return parseRobotsTxt(content, "ReaderEngine");
  } catch {
    // Network error or invalid URL - allow everything
    return null;
  }
}

/**
 * Check if a URL is allowed by robots.txt
 */
export function isUrlAllowed(url: string, rules: RobotsRules | null): boolean {
  if (!rules) {
    return true;
  }

  try {
    const parsedUrl = new URL(url);
    return isPathAllowed(parsedUrl.pathname + parsedUrl.search, rules);
  } catch {
    return true;
  }
}
