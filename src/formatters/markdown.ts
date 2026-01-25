import TurndownService from "turndown";
import type { Page, WebsiteMetadata } from "../types";

// Initialize Turndown service
const turndownService = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  fence: "```",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined",
  linkReferenceStyle: "full",
});

/**
 * Convert pages to consolidated Markdown format
 */
export function formatToMarkdown(
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
    sections.push(createMarkdownHeader(baseUrl, scrapedAt, duration, website, pages.length));
  }

  // Add table of contents if multiple pages
  if (pages.length > 1) {
    sections.push(createMarkdownTOC(pages));
  }

  // Add page content
  sections.push(...pages.map((page, index) => createMarkdownPage(page, index + 1)));

  return sections.join("\n\n");
}

/**
 * Create Markdown header with metadata
 */
function createMarkdownHeader(
  baseUrl: string,
  scrapedAt: string,
  duration: number,
  website: WebsiteMetadata,
  totalPages: number
): string {
  const title = website.title || extractDomainFromUrl(baseUrl);
  const description = website.description || "";

  let header = `# Website Scrape: ${title}\n\n`;

  header += `**Base URL:** ${baseUrl}\n`;
  header += `**Scraped at:** ${new Date(scrapedAt).toLocaleString()}\n`;
  header += `**Duration:** ${duration}ms\n`;
  header += `**Total pages:** ${totalPages}\n`;

  if (description) {
    header += `**Description:** ${description}\n`;
  }

  if (website.author) {
    header += `**Author:** ${website.author}\n`;
  }

  if (website.language) {
    header += `**Language:** ${website.language}\n`;
  }

  return header;
}

/**
 * Create table of contents in Markdown
 */
function createMarkdownTOC(pages: Page[]): string {
  let toc = "## Table of Contents\n\n";

  pages.forEach((page, index) => {
    const depth = "  ".repeat(page.depth);
    const pageNumber = index + 1;
    const title = page.title || `Page ${pageNumber}`;
    const cleanTitle = title.replace(/[#[\]/\\:*?"<>|]/g, "").trim();

    // Create anchor link
    const anchor = cleanTitle
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    toc += `${depth}${pageNumber}. [${title}](#page-${pageNumber}-${anchor})\n`;
  });

  return toc;
}

/**
 * Create individual page content in Markdown
 */
function createMarkdownPage(page: Page, pageNumber: number): string {
  const title = page.title || `Page ${pageNumber}`;
  const cleanTitle = title.replace(/[#[\]/\\:*?"<>|]/g, "").trim();
  const anchor = cleanTitle
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  let pageContent = `---\n\n`;
  pageContent += `## Page ${pageNumber}: ${title} {#page-${pageNumber}-${anchor}}\n\n`;

  pageContent += `**URL:** ${page.url}\n`;
  pageContent += `**Title:** ${page.title}\n`;
  pageContent += `**Depth:** ${page.depth}\n`;
  pageContent += `**Fetched at:** ${new Date(page.fetchedAt).toLocaleString()}\n\n`;

  // Add horizontal rule
  pageContent += `---\n\n`;

  // Convert HTML to Markdown
  const markdown = htmlToMarkdown(page.html);
  pageContent += markdown;

  return pageContent;
}

/**
 * Convert HTML to Markdown using Turndown
 */
function htmlToMarkdown(html: string): string {
  try {
    return turndownService.turndown(html);
  } catch (error) {
    console.warn("Error converting HTML to Markdown:", error);
    // Fallback: extract text content
    return html.replace(/<[^>]*>/g, "").trim();
  }
}

/**
 * Create compact Markdown format for LLM consumption
 */
export function formatToCompactMarkdown(pages: Page[], website: WebsiteMetadata): string {
  const sections: string[] = [];

  // Add minimal header
  sections.push(`# ${website.title || extractDomainFromUrl(pages[0].url)}\n`);

  if (website.description) {
    sections.push(`*${website.description}*\n`);
  }

  // Add pages without metadata
  pages.forEach((page) => {
    const title = page.title || "Untitled";
    sections.push(`## ${title}\n`);
    sections.push(`Source: ${page.url}\n`);

    const markdown = htmlToMarkdown(page.html);
    sections.push(markdown);
    sections.push("\n---\n");
  });

  return sections.join("\n");
}

/**
 * Create Markdown for individual pages
 */
export function formatPageToMarkdown(page: Page): string {
  const title = page.title || "Untitled";
  let markdown = `# ${title}\n\n`;

  markdown += `**URL:** ${page.url}\n`;
  markdown += `**Fetched:** ${new Date(page.fetchedAt).toLocaleString()}\n`;
  markdown += `**Depth:** ${page.depth}\n\n`;

  markdown += `---\n\n`;

  markdown += htmlToMarkdown(page.html);

  return markdown;
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
 * Create Markdown summary statistics
 */
export function createMarkdownStats(pages: Page[]): string {
  const totalWords = pages.reduce((sum, page) => sum + countWords(page.markdown), 0);
  const avgWords = Math.round(totalWords / pages.length);
  const totalReadingTime = Math.ceil(totalWords / 200); // 200 words per minute

  let stats = "## Statistics\n\n";
  stats += `- **Total pages:** ${pages.length}\n`;
  stats += `- **Total words:** ${totalWords.toLocaleString()}\n`;
  stats += `- **Average words per page:** ${avgWords.toLocaleString()}\n`;
  stats += `- **Estimated reading time:** ${totalReadingTime} minutes\n`;
  stats += `- **Crawl depth range:** ${Math.min(
    ...pages.map((p) => p.depth)
  )} - ${Math.max(...pages.map((p) => p.depth))}\n`;

  return stats;
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
