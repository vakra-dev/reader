import { parseHTML } from "linkedom";
import type { WebsiteMetadata } from "../types";
import { normalizeUrl } from "./url-helpers";

/**
 * Extract comprehensive website metadata from HTML content
 * Uses proper DOM parsing for reliable attribute extraction
 */
export function extractMetadata(html: string, baseUrl: string): WebsiteMetadata {
  return extractWebsiteMetadata(html, baseUrl);
}

/**
 * Extract comprehensive website metadata from HTML content
 */
export function extractWebsiteMetadata(html: string, baseUrl: string): WebsiteMetadata {
  const { document } = parseHTML(html);

  const metadata: WebsiteMetadata = {
    title: null,
    description: null,
    author: null,
    language: null,
    charset: null,
    favicon: null,
    canonical: null,
    image: null,
    keywords: null,
    robots: null,
    themeColor: null,
    openGraph: null,
    twitter: null,
  };

  // Extract basic meta tags
  metadata.title = extractTitle(document);
  metadata.description = extractMetaContent(document, "description");
  metadata.author = extractMetaContent(document, "author");
  metadata.language = extractLanguage(document);
  metadata.charset = extractCharset(document);

  // Extract links
  metadata.favicon = extractFavicon(document, baseUrl);
  metadata.canonical = extractCanonical(document, baseUrl);
  metadata.image =
    extractMetaContent(document, "og:image") || extractMetaContent(document, "twitter:image");

  // Extract SEO metadata
  metadata.keywords = extractKeywords(document);
  metadata.robots = extractMetaContent(document, "robots");
  metadata.themeColor = extractMetaContent(document, "theme-color");

  // Extract Open Graph metadata
  metadata.openGraph = extractOpenGraph(document);

  // Extract Twitter Card metadata
  metadata.twitter = extractTwitterCard(document);

  return metadata;
}

/**
 * Extract page title from HTML
 */
function extractTitle(document: Document): string | null {
  // Try <title> tag first
  const titleElement = document.querySelector("title");
  if (titleElement?.textContent) {
    return titleElement.textContent.trim();
  }

  // Fallback to og:title
  return extractMetaContent(document, "og:title");
}

/**
 * Extract content from meta tag by name or property
 * Works regardless of attribute order
 */
function extractMetaContent(document: Document, name: string): string | null {
  // Try name attribute first
  const byName = document.querySelector(`meta[name="${name}"]`);
  if (byName) {
    const content = byName.getAttribute("content");
    if (content) return content.trim();
  }

  // Try property attribute (for Open Graph)
  const byProperty = document.querySelector(`meta[property="${name}"]`);
  if (byProperty) {
    const content = byProperty.getAttribute("content");
    if (content) return content.trim();
  }

  return null;
}

/**
 * Extract language from HTML tag
 */
function extractLanguage(document: Document): string | null {
  const lang = document.documentElement?.getAttribute("lang");
  return lang?.trim() || null;
}

/**
 * Extract character set from meta tag
 */
function extractCharset(document: Document): string | null {
  // Try <meta charset="...">
  const charsetMeta = document.querySelector("meta[charset]");
  if (charsetMeta) {
    const charset = charsetMeta.getAttribute("charset");
    if (charset) return charset.trim();
  }

  // Try <meta http-equiv="Content-Type" content="...charset=...">
  const httpEquivMeta = document.querySelector('meta[http-equiv="Content-Type"]');
  if (httpEquivMeta) {
    const content = httpEquivMeta.getAttribute("content");
    if (content) {
      const charsetMatch = content.match(/charset=([^\s;]+)/i);
      if (charsetMatch) return charsetMatch[1].trim();
    }
  }

  return null;
}

/**
 * Extract favicon URL
 */
function extractFavicon(document: Document, baseUrl: string): string | null {
  // Try various icon link types
  const iconSelectors = [
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
    'link[rel="apple-touch-icon"]',
    'link[rel*="icon"]',
  ];

  for (const selector of iconSelectors) {
    const iconLink = document.querySelector(selector);
    if (iconLink) {
      const href = iconLink.getAttribute("href");
      if (href) {
        return normalizeUrl(href, baseUrl);
      }
    }
  }

  // Fallback to /favicon.ico
  try {
    return normalizeUrl("/favicon.ico", baseUrl);
  } catch {
    return null;
  }
}

/**
 * Extract canonical URL
 */
function extractCanonical(document: Document, baseUrl: string): string | null {
  const canonicalLink = document.querySelector('link[rel="canonical"]');
  if (canonicalLink) {
    const href = canonicalLink.getAttribute("href");
    if (href) {
      return normalizeUrl(href, baseUrl);
    }
  }

  return null;
}

/**
 * Extract keywords from meta tag
 */
function extractKeywords(document: Document): string[] | null {
  const keywordsContent = extractMetaContent(document, "keywords");
  if (!keywordsContent) {
    return null;
  }

  return keywordsContent
    .split(",")
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0);
}

/**
 * Extract Open Graph metadata
 */
function extractOpenGraph(document: Document): WebsiteMetadata["openGraph"] {
  const openGraph: WebsiteMetadata["openGraph"] = {
    title: null,
    description: null,
    type: null,
    url: null,
    image: null,
    siteName: null,
    locale: null,
  };

  openGraph.title = extractMetaContent(document, "og:title");
  openGraph.description = extractMetaContent(document, "og:description");
  openGraph.type = extractMetaContent(document, "og:type");
  openGraph.url = extractMetaContent(document, "og:url");
  openGraph.image = extractMetaContent(document, "og:image");
  openGraph.siteName = extractMetaContent(document, "og:site_name");
  openGraph.locale = extractMetaContent(document, "og:locale");

  // Return null if no Open Graph data found
  if (Object.values(openGraph).every((value) => !value)) {
    return null;
  }

  return openGraph;
}

/**
 * Extract Twitter Card metadata
 */
function extractTwitterCard(document: Document): WebsiteMetadata["twitter"] {
  const twitter: WebsiteMetadata["twitter"] = {
    card: null,
    site: null,
    creator: null,
    title: null,
    description: null,
    image: null,
  };

  twitter.card = extractMetaContent(document, "twitter:card");
  twitter.site = extractMetaContent(document, "twitter:site");
  twitter.creator = extractMetaContent(document, "twitter:creator");
  twitter.title = extractMetaContent(document, "twitter:title");
  twitter.description = extractMetaContent(document, "twitter:description");
  twitter.image = extractMetaContent(document, "twitter:image");

  // Return null if no Twitter Card data found
  if (Object.values(twitter).every((value) => !value)) {
    return null;
  }

  return twitter;
}

/**
 * Extract structured data (JSON-LD) from HTML
 */
export function extractStructuredData(html: string): unknown[] {
  const { document } = parseHTML(html);
  const structuredData: unknown[] = [];

  document.querySelectorAll('script[type="application/ld+json"]').forEach((script: Element) => {
    try {
      const jsonData = JSON.parse(script.textContent || "");
      structuredData.push(jsonData);
    } catch {
      // Invalid JSON, skip
    }
  });

  return structuredData;
}

/**
 * Extract microdata from HTML (basic implementation)
 */
export function extractMicrodata(_html: string): unknown[] {
  const microdata: unknown[] = [];
  // This is a simplified implementation
  // In a real-world scenario, you'd want to use a proper microdata parser
  return microdata;
}

/**
 * Get a summary of the website metadata for debugging
 */
export function getMetadataSummary(metadata: WebsiteMetadata): string {
  const parts: string[] = [];

  if (metadata.title) parts.push(`Title: ${metadata.title}`);
  if (metadata.description) parts.push(`Description: ${metadata.description.substring(0, 100)}...`);
  if (metadata.author) parts.push(`Author: ${metadata.author}`);
  if (metadata.language) parts.push(`Language: ${metadata.language}`);
  if (metadata.keywords) parts.push(`Keywords: ${metadata.keywords.length} found`);
  if (metadata.openGraph)
    parts.push(`Open Graph: ${Object.keys(metadata.openGraph).length} fields`);
  if (metadata.twitter) parts.push(`Twitter Card: ${Object.keys(metadata.twitter).length} fields`);

  return parts.join(" | ") || "No metadata found";
}
