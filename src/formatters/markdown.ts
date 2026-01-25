import TurndownService from "turndown";

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
 * Convert HTML to Markdown
 *
 * Simple conversion without any headers, metadata, or formatting wrappers.
 * Returns clean markdown content ready for LLM consumption.
 */
export function htmlToMarkdown(html: string): string {
  try {
    return turndownService.turndown(html);
  } catch (error) {
    console.warn("Error converting HTML to Markdown:", error);
    // Fallback: extract text content
    return html.replace(/<[^>]*>/g, "").trim();
  }
}

/**
 * Alias for htmlToMarkdown (backward compatibility)
 */
export const formatToMarkdown = htmlToMarkdown;
