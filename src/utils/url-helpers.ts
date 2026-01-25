import { URL } from "url";
import RE2 from "re2";

/**
 * URL validation and normalization utilities
 */

/**
 * Resolve a relative URL against a base URL
 */
export function resolveUrl(relative: string, base: string): string {
  try {
    return new URL(relative, base).toString();
  } catch {
    return relative;
  }
}

/**
 * Validate if a string is a valid URL
 */
export function isValidUrl(string: string): boolean {
  try {
    new URL(string);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize a URL by removing fragments and ensuring proper format
 */
export function normalizeUrl(url: string, baseUrl?: string): string {
  try {
    let parsedUrl: URL;

    if (url.startsWith("http://") || url.startsWith("https://")) {
      parsedUrl = new URL(url);
    } else if (baseUrl) {
      parsedUrl = new URL(url, baseUrl);
    } else {
      throw new Error("Relative URL requires base URL");
    }

    // Remove fragment and search params for consistency
    parsedUrl.hash = "";

    return parsedUrl.toString();
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
}

/**
 * Extract base domain from a URL
 */
export function extractBaseDomain(url: string): string {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname;
  } catch {
    throw new Error(`Invalid URL for domain extraction: ${url}`);
  }
}

/**
 * Extract the root domain from a hostname (e.g., "blog.example.com" -> "example.com")
 */
function getRootDomain(hostname: string): string {
  const parts = hostname.split(".");

  // Handle edge cases
  if (parts.length <= 2) {
    return hostname;
  }

  // Handle common two-part TLDs (co.uk, com.au, etc.)
  const twoPartTLDs = ["co.uk", "com.au", "co.nz", "com.br", "co.jp", "co.kr", "com.mx", "org.uk"];
  const lastTwo = parts.slice(-2).join(".");

  if (twoPartTLDs.includes(lastTwo)) {
    // Return last 3 parts for two-part TLDs
    return parts.slice(-3).join(".");
  }

  // Standard case: return last 2 parts
  return parts.slice(-2).join(".");
}

/**
 * Check if a URL belongs to the same domain as the base URL
 * Supports subdomains: blog.example.com matches example.com
 */
export function isSameDomain(url: string, baseUrl: string): boolean {
  try {
    const urlDomain = extractBaseDomain(url);
    const baseDomain = extractBaseDomain(baseUrl);

    // Exact match
    if (urlDomain === baseDomain) {
      return true;
    }

    // Check if URL is a subdomain of base domain
    // e.g., "blog.example.com" should match "example.com"
    const urlRoot = getRootDomain(urlDomain);
    const baseRoot = getRootDomain(baseDomain);

    return urlRoot === baseRoot;
  } catch {
    return false;
  }
}

/**
 * Generate a URL key for deduplication
 * Normalizes:
 * - Removes fragments (hash)
 * - Removes search params
 * - Removes trailing slashes (except root)
 * - Lowercases
 * - Normalizes www vs non-www
 * - Removes default ports (80 for http, 443 for https)
 * - Normalizes index files (index.html, index.htm, default.html)
 */
export function getUrlKey(url: string): string {
  try {
    const parsedUrl = new URL(url);

    // Remove hash fragments
    parsedUrl.hash = "";

    // Remove search params for consistency
    parsedUrl.search = "";

    // Normalize www vs non-www (remove www. prefix for deduplication)
    if (parsedUrl.hostname.startsWith("www.")) {
      parsedUrl.hostname = parsedUrl.hostname.slice(4);
    }

    // Remove default ports (80 for http, 443 for https)
    if (
      (parsedUrl.protocol === "http:" && parsedUrl.port === "80") ||
      (parsedUrl.protocol === "https:" && parsedUrl.port === "443")
    ) {
      parsedUrl.port = "";
    }

    // Normalize index files (treat /path/index.html as /path/)
    const indexFiles = ["index.html", "index.htm", "default.html", "default.htm", "index.php"];
    for (const indexFile of indexFiles) {
      if (parsedUrl.pathname.endsWith(`/${indexFile}`)) {
        parsedUrl.pathname = parsedUrl.pathname.slice(0, -indexFile.length);
        break;
      }
    }

    // Normalize trailing slashes (keep for root path only)
    let normalized = parsedUrl.toString().toLowerCase();
    if (normalized.endsWith("/") && parsedUrl.pathname !== "/") {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Validate an array of URLs and return validation results
 */
export function validateUrls(urls: string[]): {
  isValid: boolean;
  validUrls: string[];
  errors: Array<{ url: string; error: string }>;
} {
  const validUrls: string[] = [];
  const errors: Array<{ url: string; error: string }> = [];

  if (!urls || urls.length === 0) {
    return {
      isValid: false,
      validUrls: [],
      errors: [{ url: "", error: "At least one URL is required" }],
    };
  }

  for (const url of urls) {
    if (!url || typeof url !== "string") {
      errors.push({
        url: String(url),
        error: "URL must be a non-empty string",
      });
      continue;
    }

    const trimmedUrl = url.trim();
    if (trimmedUrl === "") {
      errors.push({ url: String(url), error: "URL cannot be empty" });
      continue;
    }

    if (!isValidUrl(trimmedUrl)) {
      errors.push({ url: trimmedUrl, error: "Invalid URL format" });
      continue;
    }

    if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
      errors.push({
        url: trimmedUrl,
        error: "URL must start with http:// or https://",
      });
      continue;
    }

    validUrls.push(trimmedUrl);
  }

  // Remove duplicates while preserving order
  const uniqueValidUrls = Array.from(new Set(validUrls));

  return {
    isValid: uniqueValidUrls.length > 0 && errors.length === 0,
    validUrls: uniqueValidUrls,
    errors,
  };
}

/**
 * Check if a URL matches any of the given regex patterns
 *
 * Uses Google's RE2 engine which guarantees linear time execution,
 * preventing ReDoS attacks from malicious or pathological patterns.
 */
export function matchesPatterns(url: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) {
    return false;
  }

  return patterns.some((pattern) => {
    try {
      const regex = new RE2(pattern, "i");
      return regex.test(url);
    } catch {
      // Invalid regex pattern or unsupported RE2 syntax, skip it
      return false;
    }
  });
}

/**
 * Check if a URL should be included based on include/exclude patterns
 * - If includePatterns is set, URL must match at least one
 * - If excludePatterns is set, URL must not match any
 */
export function shouldIncludeUrl(
  url: string,
  includePatterns?: string[],
  excludePatterns?: string[]
): boolean {
  // If include patterns are specified, URL must match at least one
  if (includePatterns && includePatterns.length > 0) {
    if (!matchesPatterns(url, includePatterns)) {
      return false;
    }
  }

  // If exclude patterns are specified, URL must not match any
  if (excludePatterns && excludePatterns.length > 0) {
    if (matchesPatterns(url, excludePatterns)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a URL is likely a content page (not legal, policy, or utility page)
 * Used by crawler to filter out non-content pages
 */
export function isContentUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();

  // Skip legal and policy pages
  const nonContentPatterns = [
    // Legal and policy pages
    /\/(privacy|terms|tos|legal|cookie|gdpr|disclaimer|imprint|impressum)\b/i,
    /\/(privacy-policy|terms-of-service|terms-of-use|terms-and-conditions)\b/i,
    /\/(cookie-policy|data-protection|acceptable-use|user-agreement)\b/i,
    /\/(refund|cancellation|shipping|return)-?(policy)?\b/i,
    // Contact and support pages (usually not main content)
    /\/(contact|support|help|faq|feedback)\/?$/i,
    // About pages that are typically boilerplate
    /\/(about-us|careers|jobs|press|investors|team)\/?$/i,
    // Authentication and admin areas
    /\/(admin|login|auth|account|dashboard|profile|settings)\//i,
    // E-commerce utility pages
    /\/(cart|checkout|payment|subscription|wishlist)\//i,
    // File downloads and assets
    /\/(uploads|assets|files|static|media|resources)\//i,
    // API endpoints
    /\/(api|graphql|rest|webhook)\//i,
  ];

  if (nonContentPatterns.some((pattern) => pattern.test(lowerUrl))) {
    return false;
  }

  // Skip common non-content file extensions
  const skipExtensions = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".zip", ".exe"];
  if (skipExtensions.some((ext) => lowerUrl.endsWith(ext))) {
    return false;
  }

  return true;
}

/**
 * Check if a URL should be crawled based on various criteria
 */
export function shouldCrawlUrl(
  url: string,
  baseUrl: string,
  maxDepth: number,
  currentDepth: number,
  visited: Set<string>
): boolean {
  // Check depth limit - FIXED: use > instead of >=
  if (currentDepth > maxDepth) {
    return false;
  }

  // Check if already visited
  const urlKey = getUrlKey(url);
  if (visited.has(urlKey)) {
    return false;
  }

  // Check if same domain
  if (!isSameDomain(url, baseUrl)) {
    return false;
  }

  // Enhanced filtering for non-content files and patterns
  const lowerUrl = url.toLowerCase();

  // Skip common non-content file extensions
  const skipExtensions = [
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".zip",
    ".rar",
    ".tar",
    ".gz",
    ".exe",
    ".dmg",
    ".pkg",
    ".deb",
    ".rpm",
    ".apk",
    ".ipa",
    // Image files
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
    ".svg",
    ".webp",
    ".ico",
    ".favicon",
    // Video files
    ".mp4",
    ".avi",
    ".mov",
    ".wmv",
    ".flv",
    ".webm",
    // Audio files
    ".mp3",
    ".wav",
    ".ogg",
    ".m4a",
    ".aac",
    // Font files
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".eot",
    // Style and script files
    ".css",
    ".js",
    ".mjs",
    ".ts",
    ".jsx",
    ".tsx",
    // Data and config files
    ".json",
    ".xml",
    ".txt",
    ".md",
    ".rss",
    ".atom",
    ".sitemap",
    ".robots",
    ".webmanifest",
    // Archive files
    ".zip",
    ".tar",
    ".gz",
    ".bz2",
    ".7z",
  ];

  if (skipExtensions.some((ext) => lowerUrl.includes(ext))) {
    return false;
  }

  // Skip common non-content URL patterns
  const skipPatterns = [
    // File downloads and assets
    /\/(uploads|assets|files|static|media|resources)\//i,
    // Authentication and admin areas
    /\/(admin|login|auth|account|dashboard|profile|settings)\//i,
    // API endpoints
    /\/(api|graphql|rest|ws:|webhook)\//i,
    // Common tracking and analytics
    /\/(analytics|tracking|pixel|beacon|ads)\//i,
    // Development and testing areas
    /\/(test|dev|staging|beta|demo)\//i,
    // Common utility and service pages
    /\/(search|cart|checkout|payment|subscription)\//i,
    // Social media and external services
    /\/(facebook|twitter|instagram|youtube|linkedin|github)\//i,
    // Legal and policy pages
    /\/(privacy|terms|tos|legal|cookie|gdpr|disclaimer|imprint|impressum)\b/i,
    /\/(privacy-policy|terms-of-service|terms-of-use|terms-and-conditions)\b/i,
    /\/(cookie-policy|data-protection|acceptable-use|user-agreement)\b/i,
    /\/(refund|cancellation|shipping|return)-?(policy)?\b/i,
    // Contact and support pages (usually not main content)
    /\/(contact|support|help|faq|feedback)\/?$/i,
    // About pages that are typically boilerplate
    /\/(about-us|careers|jobs|press|investors|team)\/?$/i,
  ];

  if (skipPatterns.some((pattern) => pattern.test(url))) {
    return false;
  }

  // Skip URLs with query parameters that indicate non-content
  if (
    url.includes("?") &&
    ["download", "file", "attachment", "export", "print", "share", "email"].some((param) =>
      url.toLowerCase().includes(param)
    )
  ) {
    return false;
  }

  // Skip very short URLs (likely navigation or utility)
  if (url.split("/").filter(Boolean).length < 2 && url.split("?")[0].split("/").length <= 2) {
    return false;
  }

  return true;
}
