import type { Page, WebsiteMetadata } from "../types";

/**
 * Convert pages to JSON format with metadata
 */
export function formatToJson(
  pages: Page[],
  baseUrl: string,
  scrapedAt: string,
  duration: number,
  website: WebsiteMetadata
): string {
  const jsonResult = {
    metadata: {
      baseUrl,
      totalPages: pages.length,
      scrapedAt,
      duration,
      website,
    },
    pages: pages.map((page, index) => ({
      index: index + 1,
      url: page.url,
      title: page.title,
      markdown: page.markdown,
      html: page.html,
      fetchedAt: page.fetchedAt,
      depth: page.depth,
      wordCount: countWords(page.markdown),
      readingTime: estimateReadingTime(page.markdown),
    })),
  };

  return JSON.stringify(jsonResult, null, 2);
}

/**
 * Convert pages to JSON format without HTML (lighter version)
 */
export function formatToJsonLite(
  pages: Page[],
  baseUrl: string,
  scrapedAt: string,
  duration: number,
  website: WebsiteMetadata
): string {
  const jsonResult = {
    metadata: {
      baseUrl,
      totalPages: pages.length,
      scrapedAt,
      duration,
      website,
    },
    pages: pages.map((page, index) => ({
      index: index + 1,
      url: page.url,
      title: page.title,
      markdown: page.markdown,
      fetchedAt: page.fetchedAt,
      depth: page.depth,
      wordCount: countWords(page.markdown),
      readingTime: estimateReadingTime(page.markdown),
    })),
  };

  return JSON.stringify(jsonResult, null, 2);
}

/**
 * Count words in markdown text
 */
function countWords(markdown: string): number {
  // Remove markdown syntax
  const plainText = markdown
    .replace(/#{1,6}\s+/g, "") // Headers
    .replace(/\*\*(.*?)\*\*/g, "$1") // Bold
    .replace(/\*(.*?)\*/g, "$1") // Italic
    .replace(/`(.*?)`/g, "$1") // Inline code
    .replace(/```[\s\S]*?```/g, "") // Code blocks
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Links
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1") // Images
    .replace(/^\s*[-*+]\s+/gm, "") // List items
    .replace(/^\s*\d+\.\s+/gm, "") // Numbered lists
    .replace(/^\s*>\s+/gm, "") // Blockquotes
    .replace(/\n{3,}/g, "\n\n") // Multiple newlines
    .trim();

  // Split by whitespace and filter out empty strings
  return plainText.split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * Estimate reading time in minutes (average 200 words per minute)
 */
function estimateReadingTime(markdown: string): number {
  const wordCount = countWords(markdown);
  return Math.ceil(wordCount / 200);
}

/**
 * Create a table of contents for JSON output
 */
export function createJsonTOC(pages: Page[]): string {
  return JSON.stringify(
    {
      tableOfContents: pages.map((page, index) => ({
        index: index + 1,
        title: page.title,
        url: page.url,
        depth: page.depth,
      })),
    },
    null,
    2
  );
}
