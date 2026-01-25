/**
 * HTML formatter
 *
 * Returns the cleaned HTML content as-is.
 * The content has already been processed by content-cleaner.ts
 * (ads removed, base64 images stripped, scripts/styles removed).
 */

/**
 * Return HTML content as-is (already cleaned by content-cleaner)
 *
 * This is essentially a pass-through. The cleaning happens in scraper.ts
 * via cleanContent() before this is called.
 */
export function formatToHTML(html: string): string {
  return html;
}
