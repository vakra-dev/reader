import { parseHTML } from "linkedom";
import type { Page, WebsiteMetadata } from "../types";

/**
 * Convert pages to plain text format
 *
 * Strips all HTML tags and formatting, preserving only readable text content.
 * Useful for LLM consumption where markdown formatting is not needed.
 */
export function formatToText(
  pages: Page[],
  baseUrl: string,
  scrapedAt: string,
  duration: number,
  website: WebsiteMetadata,
  includeMetadata: boolean = true
): string {
  const sections: string[] = [];

  // Add header if metadata is included
  if (includeMetadata) {
    sections.push(createTextHeader(baseUrl, scrapedAt, duration, website, pages.length));
  }

  // Add page content
  sections.push(...pages.map((page, index) => createTextPage(page, index + 1, pages.length > 1)));

  return sections.join("\n\n");
}

/**
 * Create plain text header with metadata
 */
function createTextHeader(
  baseUrl: string,
  scrapedAt: string,
  duration: number,
  website: WebsiteMetadata,
  totalPages: number
): string {
  const title = website.title || extractDomainFromUrl(baseUrl);
  const lines: string[] = [];

  lines.push(`=== ${title} ===`);
  lines.push("");
  lines.push(`URL: ${baseUrl}`);
  lines.push(`Scraped: ${new Date(scrapedAt).toLocaleString()}`);
  lines.push(`Duration: ${duration}ms`);
  lines.push(`Pages: ${totalPages}`);

  if (website.description) {
    lines.push(`Description: ${website.description}`);
  }

  if (website.author) {
    lines.push(`Author: ${website.author}`);
  }

  if (website.language) {
    lines.push(`Language: ${website.language}`);
  }

  return lines.join("\n");
}

/**
 * Create individual page content in plain text
 */
function createTextPage(page: Page, pageNumber: number, showSeparator: boolean): string {
  const lines: string[] = [];

  if (showSeparator) {
    lines.push("─".repeat(60));
    lines.push(`Page ${pageNumber}: ${page.title || "Untitled"}`);
    lines.push(`URL: ${page.url}`);
    lines.push("─".repeat(60));
  }

  // Convert HTML to plain text
  const plainText = htmlToPlainText(page.html);
  lines.push(plainText);

  return lines.join("\n");
}

/**
 * Convert HTML to plain text using DOM parsing
 *
 * - Removes scripts, styles, and other non-content elements
 * - Uses textContent for clean text extraction
 * - Handles HTML entities automatically
 */
function htmlToPlainText(html: string): string {
  const { document } = parseHTML(html);

  // Remove non-content elements
  const elementsToRemove = ["script", "style", "noscript", "svg", "canvas", "template"];
  elementsToRemove.forEach((tag) => {
    document.querySelectorAll(tag).forEach((el: Element) => el.remove());
  });

  // Get text content - this automatically:
  // - Strips all HTML tags
  // - Decodes HTML entities
  // - Preserves text structure
  let text = document.body?.textContent || document.documentElement?.textContent || "";

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, " "); // Collapse horizontal whitespace
  text = text.replace(/\n[ \t]+/g, "\n"); // Remove leading whitespace on lines
  text = text.replace(/[ \t]+\n/g, "\n"); // Remove trailing whitespace on lines
  text = text.replace(/\n{3,}/g, "\n\n"); // Collapse multiple newlines to max 2
  text = text.trim();

  return text;
}

/**
 * Extract domain from URL for fallback title
 */
function extractDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "Unknown";
  }
}

/**
 * Format a single page to plain text (utility export)
 */
export function formatPageToText(page: Page): string {
  const lines: string[] = [];

  lines.push(`=== ${page.title || "Untitled"} ===`);
  lines.push(`URL: ${page.url}`);
  lines.push(`Fetched: ${new Date(page.fetchedAt).toLocaleString()}`);
  lines.push("");
  lines.push(htmlToPlainText(page.html));

  return lines.join("\n");
}
