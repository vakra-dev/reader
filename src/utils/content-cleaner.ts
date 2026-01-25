import { parseHTML } from "linkedom";
import type { Page } from "../types";

/**
 * HTML content cleaning utilities using DOM parsing
 */

/**
 * Content cleaning options
 */
export interface CleaningOptions {
  /** Remove ads and tracking elements (default: true) */
  removeAds?: boolean;
  /** Remove base64-encoded images (default: true) */
  removeBase64Images?: boolean;
}

/**
 * Selectors for elements to always remove from content
 */
const ALWAYS_REMOVE_SELECTORS = [
  // Navigation and menus
  "nav",
  "header nav",
  "footer nav",
  ".nav",
  ".navigation",
  ".menu",
  ".navbar",
  ".sidebar",
  ".aside",

  // Header and footer elements
  "header",
  "footer",
  ".site-header",
  ".page-header",
  ".site-footer",
  ".page-footer",

  // Social media and sharing
  ".social",
  ".share",
  ".sharing",
  ".twitter",
  ".facebook",
  ".linkedin",
  ".instagram",

  // Comments and discussions
  ".comments",
  ".comment",
  ".discussion",
  ".disqus",

  // Forms and interactive elements
  "form",
  "input",
  "button:not([type='submit'])",
  "select",
  "textarea",

  // Scripts and styles
  "script",
  "style",
  "noscript",

  // Hidden elements
  "[hidden]",
  "[style*='display: none']",
  "[style*='display:none']",

  // Common utility classes
  ".cookie",
  ".cookie-banner",
  ".popup",
  ".modal",
  ".overlay",
  ".notification",

  // Breadcrumbs
  ".breadcrumb",
  ".breadcrumbs",
  ".breadcrumb-trail",
];

/**
 * Selectors for ad-related elements (only removed when removeAds is true)
 */
const AD_SELECTORS = [
  // Ads and promotions
  ".ad",
  ".ads",
  ".advertisement",
  ".promotion",
  ".sponsored",
  "[class*='ad-']",
  "[id*='ad-']",
  "[class*='advert']",
  "[id*='advert']",
  "[class*='banner']",
  "[id*='banner']",
  ".google-ad",
  ".adsense",
  "[data-ad]",
  "[data-ads]",
  "ins.adsbygoogle",
  // Tracking
  "[class*='tracking']",
  "[id*='tracking']",
  "[class*='analytics']",
  "[id*='analytics']",
];

/**
 * Selectors for main content areas (in priority order)
 */
const CONTENT_SELECTORS = [
  "main",
  "article",
  ".content",
  ".main-content",
  ".post-content",
  ".entry-content",
  ".article-content",
  "[role='main']",
  ".container",
  ".wrapper",
];

/**
 * Clean HTML content by removing unwanted elements
 * Uses proper DOM parsing instead of regex for reliable element removal
 */
export function cleanHtml(
  html: string,
  baseUrl: string,
  options: CleaningOptions = {}
): string {
  const { removeAds = true, removeBase64Images = true } = options;
  const { document } = parseHTML(html);

  // Remove elements that are always unwanted
  for (const selector of ALWAYS_REMOVE_SELECTORS) {
    try {
      document.querySelectorAll(selector).forEach((el: Element) => el.remove());
    } catch {
      // Some selectors may not be supported, skip them
    }
  }

  // Remove ad-related elements if removeAds is true
  if (removeAds) {
    for (const selector of AD_SELECTORS) {
      try {
        document.querySelectorAll(selector).forEach((el: Element) => el.remove());
      } catch {
        // Some selectors may not be supported, skip them
      }
    }
  }

  // Remove base64 images if removeBase64Images is true
  if (removeBase64Images) {
    removeBase64ImagesFromDocument(document);
  }

  // Remove HTML comments by iterating through comment nodes
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

  // Remove elements with base64 background images in style attribute
  document.querySelectorAll("[style*='data:image']").forEach((el: Element) => {
    const style = el.getAttribute("style");
    if (style) {
      // Remove just the background-image property, not the whole element
      const cleanedStyle = style.replace(/background(-image)?:\s*url\([^)]*data:image[^)]*\)[^;]*;?/gi, "");
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
 * Convert relative URLs to absolute URLs in the document
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
 * Extract the main content from HTML
 * Tries to find the main content area using common selectors
 */
export function extractMainContent(
  html: string,
  baseUrl: string,
  options: CleaningOptions = {}
): string {
  const cleanedHtml = cleanHtml(html, baseUrl, options);
  const { document } = parseHTML(cleanedHtml);

  // Try to find main content areas in priority order
  for (const selector of CONTENT_SELECTORS) {
    try {
      const element = document.querySelector(selector);
      if (element && element.innerHTML.trim().length > 100) {
        // Return the inner HTML of the content area
        return element.innerHTML;
      }
    } catch {
      // Selector not supported, continue
    }
  }

  // If no specific content area found, return the body content or full cleaned HTML
  return document.body?.innerHTML || cleanedHtml;
}

/**
 * Clean HTML content (alias for cleanHtml with options)
 */
export function cleanContent(
  html: string,
  baseUrl: string,
  options: CleaningOptions = {}
): string {
  return cleanHtml(html, baseUrl, options);
}

/**
 * Clean and process page content
 */
export function processPageContent(
  page: Page,
  baseUrl: string,
  options: CleaningOptions = {}
): Page {
  const cleanedHtml = extractMainContent(page.html, baseUrl, options);

  return {
    ...page,
    html: cleanedHtml,
  };
}
