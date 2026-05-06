/**
 * Markdown post-processing.
 *
 * Light-touch cleanup on the markdown output from supermarkdown. Only
 * fixes patterns that are clearly noise, not content.
 */

/**
 * Apply all post-processing passes to a markdown string.
 */
export function postprocessMarkdown(md: string): string {
  let result = md;

  // 1. Remove [Skip to Content](#...) accessibility links. These are
  //    CSS-hidden on the rendered page (only visible on keyboard focus for
  //    screen readers) but Hero sees the full DOM. Never useful content.
  result = result.replace(/\[(?:Skip|Jump) to (?:main )?Content\]\(#[^)]*\)/gi, "");

  // 2. Collapse image-in-link patterns: [![alt](img)](url) where img === url
  //    is a common pattern for clickable images that link to themselves.
  //    The duplication is noise; collapse to just the image.
  result = deduplicateImageLinks(result);

  // 3. Collapse 3+ consecutive blank lines to 2 (standard markdown separator).
  result = result.replace(/\n{3,}/g, "\n\n");

  // 4. Trim the document.
  result = result.trim();

  return result;
}

/**
 * Collapse [![alt](imgUrl)](linkUrl) to ![alt](imgUrl) when imgUrl and
 * linkUrl are the same (image links to itself).
 */
function deduplicateImageLinks(md: string): string {
  return md.replace(/\[!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)/g, (_match, alt, imgUrl, linkUrl) => {
    const imgBase = imgUrl.split(/\s+/)[0];
    const linkBase = linkUrl.split(/\s+/)[0];
    if (imgBase === linkBase) {
      return `![${alt}](${imgUrl})`;
    }
    return _match;
  });
}
