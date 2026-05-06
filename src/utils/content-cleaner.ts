import { parseHTML } from "linkedom";

/**
 * HTML content cleaning — minimal approach.
 *
 * Philosophy: strip only what is CERTAINLY not content, then let
 * supermarkdown handle the rest. Aggressive pre-cleaning with wildcard
 * selectors and heuristic scoring causes more damage than it prevents
 * (e.g. [class*="dialog"] nuked Wikipedia's entire <body>). The markdown
 * converter is the real filter.
 *
 * Pipeline:
 *   1. Remove script, style, noscript, meta, head (always)
 *   2. Remove user-provided excludeTags
 *   3. If onlyMainContent: remove nav/header/footer/sidebar (exact selectors)
 *   4. If includeTags: whitelist mode — keep only matching elements
 *   5. Remove base64 images (if enabled)
 *   6. Resolve srcset to pick largest image
 *   7. Absolutify relative URLs
 */

/**
 * Content cleaning options
 */
export interface CleaningOptions {
  /** Remove ads and tracking elements (default: true) */
  removeAds?: boolean;
  /** Remove base64-encoded images (default: true) */
  removeBase64Images?: boolean;
  /** Extract only main content, removing nav/header/footer/sidebar (default: true) */
  onlyMainContent?: boolean;
  /** CSS selectors for elements to include (if set, only these elements are kept) */
  includeTags?: string[];
  /** CSS selectors for elements to exclude (removed from output) */
  excludeTags?: string[];
  /** Additional CSS selectors to remove when onlyMainContent is true. Merged with built-in selectors. */
  navigationSelectors?: string[];
}

/**
 * Elements that are NEVER content. Safe to remove unconditionally.
 */
const ALWAYS_REMOVE_SELECTORS = ["script", "style", "noscript", "meta", "head"];

/**
 * Navigation/boilerplate selectors — applied only when onlyMainContent
 * is true. Exact class/ID matches only, NO wildcards like [class*="..."]
 * which risk matching legitimate content containers.
 */
const NAVIGATION_SELECTORS = [
  // Semantic elements
  "header",
  "footer",
  "nav",
  "aside",

  // Header variations
  ".header",
  ".top",
  ".navbar",
  "#header",

  // Footer variations
  ".footer",
  ".bottom",
  "#footer",

  // Sidebars
  ".sidebar",
  ".side",
  ".aside",
  "#sidebar",

  // Modals/popups (exact class only)
  ".modal",
  ".popup",
  "#modal",
  ".overlay",

  // Ads
  ".ad",
  ".ads",
  ".advert",
  "#ad",

  // Language selectors
  ".lang-selector",
  ".language",
  "#language-selector",

  // Social
  ".social",
  ".social-media",
  ".social-links",
  "#social",

  // Navigation/menus
  ".menu",
  ".navigation",
  "#nav",

  // Breadcrumbs
  ".breadcrumbs",
  "#breadcrumbs",

  // Share buttons
  ".share",
  "#share",

  // Widgets
  ".widget",
  "#widget",

  // Cookie notices
  ".cookie",
  "#cookie",
];

/**
 * Elements containing these selectors are PROTECTED from nav removal.
 * Prevents stripping a <header> or <nav> that wraps the actual content
 * on sites with non-standard layouts (e.g. Wikipedia's #content lives
 * inside a structure that could match nav selectors on some themes).
 */
const FORCE_INCLUDE_SELECTORS = [
  "#main",
  "#content",
  "#main-content",
  "#mw-content-text",
  "#bodyContent",
  "main",
  "article",
  "[role='main']",
  "[data-page-content]",
];

// ============================================================================
// Removal Functions
// ============================================================================

/**
 * Simple removal — no protection checks.
 */
function removeElements(document: Document, selectors: string[]): void {
  for (const selector of selectors) {
    try {
      document.querySelectorAll(selector).forEach((el: Element) => el.remove());
    } catch {
      // Some selectors may not be supported by linkedom, skip them
    }
  }
}

/**
 * Remove elements WITH PROTECTION — checks each element before removing.
 * If an element IS or CONTAINS a protected selector, skip it.
 */
function removeWithProtection(
  document: Document,
  selectorsToRemove: string[],
  protectedSelectors: string[]
): void {
  for (const selector of selectorsToRemove) {
    try {
      document.querySelectorAll(selector).forEach((element: Element) => {
        // Is this element itself protected?
        const isProtected = protectedSelectors.some((ps) => {
          try {
            return element.matches(ps);
          } catch {
            return false;
          }
        });
        if (isProtected) return;

        // Does it CONTAIN protected content?
        const containsProtected = protectedSelectors.some((ps) => {
          try {
            return element.querySelector(ps) !== null;
          } catch {
            return false;
          }
        });
        if (containsProtected) return;

        element.remove();
      });
    } catch {
      // Skip invalid selector
    }
  }
}

// ============================================================================
// Main Cleaning Function
// ============================================================================

/**
 * Clean HTML content with minimal, safe transformations.
 */
export function cleanHtml(html: string, baseUrl: string, options: CleaningOptions = {}): string {
  const { removeBase64Images = true, onlyMainContent = true, includeTags, excludeTags } = options;

  const { document } = parseHTML(html);

  // Step 1: Always remove elements that are never content
  removeElements(document, ALWAYS_REMOVE_SELECTORS);

  // Step 2: Apply user-provided excludeTags
  if (excludeTags && excludeTags.length > 0) {
    removeElements(document, excludeTags);
  }

  // Step 3: Remove navigation/boilerplate (only when onlyMainContent is on)
  if (onlyMainContent) {
    const navSelectors = options.navigationSelectors
      ? [...NAVIGATION_SELECTORS, ...options.navigationSelectors]
      : NAVIGATION_SELECTORS;
    removeWithProtection(document, navSelectors, FORCE_INCLUDE_SELECTORS);
  }

  // Step 4: Apply user-provided includeTags (whitelist mode)
  if (includeTags && includeTags.length > 0) {
    const matchedElements: Element[] = [];
    for (const selector of includeTags) {
      try {
        document.querySelectorAll(selector).forEach((el: Element) => {
          matchedElements.push(el.cloneNode(true) as Element);
        });
      } catch {
        // Invalid selector, skip
      }
    }
    if (matchedElements.length > 0) {
      const body = document.body;
      if (body) {
        body.innerHTML = "";
        matchedElements.forEach((el) => body.appendChild(el));
      }
    }
  }

  // Step 5: Remove base64 images
  if (removeBase64Images) {
    removeBase64ImagesFromDocument(document);
  }

  // Step 6: Remove HTML comments
  const walker = document.createTreeWalker(document, 128 /* NodeFilter.SHOW_COMMENT */);
  const comments: Node[] = [];
  while (walker.nextNode()) {
    comments.push(walker.currentNode);
  }
  comments.forEach((comment) => comment.parentNode?.removeChild(comment));

  // Step 7: Resolve srcset to pick the largest image
  resolveSrcsets(document);

  // Step 8: Convert relative URLs to absolute
  convertRelativeUrls(document, baseUrl);

  return document.documentElement?.outerHTML || html;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Remove base64-encoded images from the document
 */
function removeBase64ImagesFromDocument(document: Document): void {
  document.querySelectorAll("img[src^='data:']").forEach((el: Element) => {
    el.remove();
  });

  document.querySelectorAll("[style*='data:image']").forEach((el: Element) => {
    const style = el.getAttribute("style");
    if (style) {
      const cleanedStyle = style.replace(
        /background(-image)?:\s*url\([^)]*data:image[^)]*\)[^;]*;?/gi,
        ""
      );
      if (cleanedStyle.trim()) {
        el.setAttribute("style", cleanedStyle);
      } else {
        el.removeAttribute("style");
      }
    }
  });

  document
    .querySelectorAll("source[src^='data:'], source[srcset*='data:']")
    .forEach((el: Element) => {
      el.remove();
    });
}

/**
 * Resolve srcset attributes to pick the largest image.
 */
function resolveSrcsets(document: Document): void {
  document.querySelectorAll("img[srcset]").forEach((el: Element) => {
    const srcset = el.getAttribute("srcset");
    if (!srcset) return;

    const candidates = srcset
      .split(",")
      .map((entry) => {
        const trimmed = entry.trim();
        const parts = trimmed.split(/\s+/);
        const url = parts[0];
        const descriptor = parts[1] || "1x";
        let weight = 0;
        if (descriptor.endsWith("w")) {
          weight = parseInt(descriptor.slice(0, -1), 10) || 0;
        } else if (descriptor.endsWith("x")) {
          weight = (parseFloat(descriptor.slice(0, -1)) || 1) * 100;
        }
        return { url, weight };
      })
      .filter((c) => c.url)
      .sort((a, b) => b.weight - a.weight);

    if (candidates.length > 0) {
      el.setAttribute("src", candidates[0].url);
    }
  });
}

/**
 * Convert relative URLs to absolute URLs
 */
function convertRelativeUrls(document: Document, baseUrl: string): void {
  document.querySelectorAll("[src]").forEach((el: Element) => {
    const src = el.getAttribute("src");
    if (src && !src.startsWith("http") && !src.startsWith("//") && !src.startsWith("data:")) {
      try {
        el.setAttribute("src", new URL(src, baseUrl).toString());
      } catch {
        /* Invalid URL, leave as-is */
      }
    }
  });

  document.querySelectorAll("[href]").forEach((el: Element) => {
    const href = el.getAttribute("href");
    if (
      href &&
      !href.startsWith("http") &&
      !href.startsWith("//") &&
      !href.startsWith("#") &&
      !href.startsWith("mailto:") &&
      !href.startsWith("tel:") &&
      !href.startsWith("javascript:")
    ) {
      try {
        el.setAttribute("href", new URL(href, baseUrl).toString());
      } catch {
        /* Invalid URL, leave as-is */
      }
    }
  });
}

/**
 * Main export
 */
export function cleanContent(html: string, baseUrl: string, options: CleaningOptions = {}): string {
  return cleanHtml(html, baseUrl, options);
}
