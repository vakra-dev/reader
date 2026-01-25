import { parseHTML } from "linkedom";

/**
 * HTML content cleaning utilities using DOM parsing
 *
 * Layered extraction strategy:
 * 1. Remove scripts, styles, hidden elements (always safe)
 * 2. Remove overlays/modals (always safe)
 * 3. Remove ads (if enabled)
 * 4. Remove navigation with protection (check each element before removing)
 * 5. Find and isolate main content
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
}

/**
 * Selectors for elements that should ALWAYS be removed (never content)
 */
const ALWAYS_REMOVE_SELECTORS = [
  // Scripts and styles
  "script",
  "style",
  "noscript",
  "link[rel='stylesheet']",

  // Hidden elements
  "[hidden]",
  "[aria-hidden='true']",
  "[style*='display: none']",
  "[style*='display:none']",
  "[style*='visibility: hidden']",
  "[style*='visibility:hidden']",

  // SVG icons and decorative elements
  "svg[aria-hidden='true']",
  "svg.icon",
  "svg[class*='icon']",

  // Template and metadata
  "template",
  "meta",

  // Embeds that don't convert to text
  "iframe",
  "canvas",
  "object",
  "embed",

  // Forms (usually not main content)
  "form",
  "input",
  "select",
  "textarea",
  "button",
];

/**
 * Selectors for overlays, modals, popups (always remove)
 */
const OVERLAY_SELECTORS = [
  "[class*='modal']",
  "[class*='popup']",
  "[class*='overlay']",
  "[class*='dialog']",
  "[role='dialog']",
  "[role='alertdialog']",
  "[class*='cookie']",
  "[class*='consent']",
  "[class*='gdpr']",
  "[class*='privacy-banner']",
  "[class*='notification-bar']",
  "[id*='cookie']",
  "[id*='consent']",
  "[id*='gdpr']",
  // Fixed/sticky positioned elements
  "[style*='position: fixed']",
  "[style*='position:fixed']",
  "[style*='position: sticky']",
  "[style*='position:sticky']",
];

/**
 * Navigation/boilerplate selectors - exact matches only
 * No wildcards like [class*="nav-"] which are too aggressive
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

  // Modals/popups (backup if not caught by OVERLAY_SELECTORS)
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

  // Cookie notices (backup)
  ".cookie",
  "#cookie",
];

/**
 * Force-include selectors - elements containing these are PROTECTED from removal
 */
const FORCE_INCLUDE_SELECTORS = [
  // IDs
  "#main",
  "#content",
  "#main-content",
  "#article",
  "#post",
  "#page-content",

  // Semantic elements
  "main",
  "article",
  "[role='main']",

  // Classes
  ".main-content",
  ".content",
  ".post-content",
  ".article-content",
  ".entry-content",
  ".page-content",
  ".article-body",
  ".post-body",
  ".story-content",
  ".blog-content",
];

/**
 * Ad-related selectors (removed when removeAds is true)
 */
const AD_SELECTORS = [
  // Google ads
  "ins.adsbygoogle",
  ".google-ad",
  ".adsense",

  // Generic ad containers
  "[data-ad]",
  "[data-ads]",
  "[data-ad-slot]",
  "[data-ad-client]",

  // Common ad class patterns
  ".ad-container",
  ".ad-wrapper",
  ".advertisement",
  ".sponsored-content",

  // Tracking pixels
  "img[width='1'][height='1']",
  "img[src*='pixel']",
  "img[src*='tracking']",
  "img[src*='analytics']",
];

// ============================================================================
// Content Scoring Heuristics
// ============================================================================

/**
 * Calculate link density of an element (ratio of link text to total text)
 * High link density (>0.5) indicates navigation, not content
 */
function getLinkDensity(element: Element): number {
  const text = element.textContent || "";
  const textLength = text.trim().length;
  if (textLength === 0) return 1;

  let linkLength = 0;
  element.querySelectorAll("a").forEach((link: Element) => {
    linkLength += (link.textContent || "").trim().length;
  });

  return linkLength / textLength;
}

/**
 * Calculate content score for an element
 * Higher scores indicate more likely to be main content
 */
function getContentScore(element: Element): number {
  let score = 0;
  const text = element.textContent || "";
  const textLength = text.trim().length;

  // Positive signals
  score += Math.min(textLength / 100, 50); // Text density (capped)
  score += element.querySelectorAll("p").length * 3; // Paragraphs
  score += element.querySelectorAll("h1, h2, h3, h4, h5, h6").length * 2; // Headings
  score += element.querySelectorAll("img").length * 1; // Images (slight bonus)

  // Negative signals
  score -= element.querySelectorAll("a").length * 0.5; // Too many links
  score -= element.querySelectorAll("li").length * 0.2; // Too many list items

  // Link density penalty
  const linkDensity = getLinkDensity(element);
  if (linkDensity > 0.5) score -= 30;
  else if (linkDensity > 0.3) score -= 15;

  // Class/ID signals
  const classAndId = (element.className || "") + " " + (element.id || "");
  if (/article|content|post|body|main|entry/i.test(classAndId)) score += 25;
  if (/comment|sidebar|footer|nav|menu|header|widget|ad/i.test(classAndId)) score -= 25;

  return score;
}

/**
 * Check if an element looks like navigation (high link density, list-heavy)
 */
function looksLikeNavigation(element: Element): boolean {
  const linkDensity = getLinkDensity(element);
  if (linkDensity > 0.5) return true;

  // Check for menu-like structures (many list items with links)
  const listItems = element.querySelectorAll("li");
  const links = element.querySelectorAll("a");
  if (listItems.length > 5 && links.length > listItems.length * 0.8) return true;

  return false;
}

// ============================================================================
// Removal Functions
// ============================================================================

/**
 * Simple removal without protection checks (for always-safe selectors)
 */
function removeElements(document: Document, selectors: string[]): void {
  for (const selector of selectors) {
    try {
      document.querySelectorAll(selector).forEach((el: Element) => el.remove());
    } catch {
      // Some selectors may not be supported, skip them
    }
  }
}

/**
 * Remove elements WITH PROTECTION - checks each element before removing
 * This is the key fix: if an element contains protected content, don't remove it
 */
function removeWithProtection(
  document: Document,
  selectorsToRemove: string[],
  protectedSelectors: string[]
): void {
  for (const selector of selectorsToRemove) {
    try {
      document.querySelectorAll(selector).forEach((element: Element) => {
        // Check 1: Is this element itself protected?
        const isProtected = protectedSelectors.some((ps) => {
          try {
            return element.matches(ps);
          } catch {
            return false;
          }
        });
        if (isProtected) return;

        // Check 2: Does element CONTAIN protected content?
        const containsProtected = protectedSelectors.some((ps) => {
          try {
            return element.querySelector(ps) !== null;
          } catch {
            return false;
          }
        });
        if (containsProtected) return;

        // Safe to remove
        element.remove();
      });
    } catch {
      // Skip invalid selector
    }
  }
}

// ============================================================================
// Main Content Extraction
// ============================================================================

/**
 * Find the main content container using multiple strategies
 */
function findMainContent(document: Document): Element | null {
  // Helper to validate a content element
  const isValidContent = (el: Element | null): el is Element => {
    if (!el) return false;
    const text = el.textContent || "";
    if (text.trim().length < 100) return false;
    // Reject if it looks like navigation
    if (looksLikeNavigation(el)) return false;
    return true;
  };

  // Priority 1: Semantic <main> element
  const main = document.querySelector("main");
  if (isValidContent(main) && getLinkDensity(main) < 0.4) {
    return main;
  }

  // Priority 2: [role="main"]
  const roleMain = document.querySelector('[role="main"]');
  if (isValidContent(roleMain) && getLinkDensity(roleMain) < 0.4) {
    return roleMain;
  }

  // Priority 3: Single <article> element
  const articles = document.querySelectorAll("article");
  if (articles.length === 1 && isValidContent(articles[0])) {
    return articles[0];
  }

  // Priority 4: Content container by ID/class
  const contentSelectors = [
    "#content",
    "#main-content",
    "#main",
    ".content",
    ".main-content",
    ".post-content",
    ".article-content",
    ".entry-content",
    ".page-content",
    ".article-body",
    ".post-body",
    ".story-content",
    ".blog-content",
  ];

  for (const selector of contentSelectors) {
    try {
      const el = document.querySelector(selector);
      if (isValidContent(el) && getLinkDensity(el) < 0.4) {
        return el;
      }
    } catch {
      // Invalid selector, skip
    }
  }

  // Priority 5: Score-based selection (find highest scoring element)
  const candidates: Array<{ el: Element; score: number }> = [];
  const containers = document.querySelectorAll("div, section, article");

  containers.forEach((el: Element) => {
    const text = el.textContent || "";
    if (text.trim().length < 200) return;

    const score = getContentScore(el);
    if (score > 0) {
      candidates.push({ el, score });
    }
  });

  // Sort by score and return highest
  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length > 0 && candidates[0].score > 20) {
    return candidates[0].el;
  }

  // No main content found
  return null;
}

/**
 * Clean HTML content using layered extraction strategy
 */
export function cleanHtml(html: string, baseUrl: string, options: CleaningOptions = {}): string {
  const {
    removeAds = true,
    removeBase64Images = true,
    onlyMainContent = true,
    includeTags,
    excludeTags,
  } = options;

  const { document } = parseHTML(html);

  // ============================================================================
  // Layer 1: Always remove scripts, styles, hidden elements, overlays
  // ============================================================================
  removeElements(document, ALWAYS_REMOVE_SELECTORS);
  removeElements(document, OVERLAY_SELECTORS);

  // ============================================================================
  // Layer 2: Remove ad-related elements (if enabled)
  // ============================================================================
  if (removeAds) {
    removeElements(document, AD_SELECTORS);
  }

  // ============================================================================
  // Layer 3: Apply user-provided excludeTags
  // ============================================================================
  if (excludeTags && excludeTags.length > 0) {
    removeElements(document, excludeTags);
  }

  // ============================================================================
  // Layer 4: Extract main content (if enabled)
  // KEY FIX: Use protection-aware removal
  // ============================================================================
  if (onlyMainContent) {
    // Remove navigation elements WITH PROTECTION
    // Each element is checked: if it contains #main, .content, etc., don't remove
    removeWithProtection(document, NAVIGATION_SELECTORS, FORCE_INCLUDE_SELECTORS);

    // Then try to find and isolate main content
    const mainContent = findMainContent(document);

    if (mainContent) {
      // Replace body with just the main content
      const body = document.body;
      if (body) {
        const clone = mainContent.cloneNode(true) as Element;
        body.innerHTML = "";
        body.appendChild(clone);
      }
    }
    // If no main content found, we've removed navigation with protection, which is good
  }

  // ============================================================================
  // Layer 5: Apply user-provided includeTags (whitelist mode)
  // ============================================================================
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

  // ============================================================================
  // Layer 6: Clean up remaining elements
  // ============================================================================

  // Remove base64 images
  if (removeBase64Images) {
    removeBase64ImagesFromDocument(document);
  }

  // Remove HTML comments
  const walker = document.createTreeWalker(document, 128 /* NodeFilter.SHOW_COMMENT */);
  const comments: Node[] = [];
  while (walker.nextNode()) {
    comments.push(walker.currentNode);
  }
  comments.forEach((comment) => comment.parentNode?.removeChild(comment));

  // Convert relative URLs to absolute
  convertRelativeUrls(document, baseUrl);

  return document.documentElement?.outerHTML || html;
}

/**
 * Remove base64-encoded images from the document
 */
function removeBase64ImagesFromDocument(document: Document): void {
  // Remove img elements with base64 src
  document.querySelectorAll("img[src^='data:']").forEach((el: Element) => {
    el.remove();
  });

  // Remove elements with base64 background images
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

  // Remove source elements with base64 src/srcset
  document.querySelectorAll("source[src^='data:'], source[srcset*='data:']").forEach((el: Element) => {
    el.remove();
  });
}

/**
 * Convert relative URLs to absolute URLs
 */
function convertRelativeUrls(document: Document, baseUrl: string): void {
  // Convert src attributes
  document.querySelectorAll("[src]").forEach((el: Element) => {
    const src = el.getAttribute("src");
    if (src && !src.startsWith("http") && !src.startsWith("//") && !src.startsWith("data:")) {
      try {
        el.setAttribute("src", new URL(src, baseUrl).toString());
      } catch {
        // Invalid URL, leave as-is
      }
    }
  });

  // Convert href attributes
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
        // Invalid URL, leave as-is
      }
    }
  });
}

/**
 * Main export - clean HTML content
 */
export function cleanContent(html: string, baseUrl: string, options: CleaningOptions = {}): string {
  return cleanHtml(html, baseUrl, options);
}
