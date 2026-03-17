/**
 * Element Reference System
 *
 * Manages @e refs that map sequential identifiers to DOM elements.
 * This allows Claude (or any consumer) to reference elements by
 * simple refs like @e1, @e3 instead of guessing CSS selectors.
 */

import type { ElementRef } from "./types.js";

/**
 * JavaScript to inject into the page that queries all interactive elements
 * and returns their metadata for ref assignment.
 */
export const QUERY_INTERACTIVE_ELEMENTS_JS = `
(function() {
  const INTERACTIVE_SELECTORS = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="switch"]',
    '[role="combobox"]',
    '[role="searchbox"]',
    '[role="slider"]',
    '[role="spinbutton"]',
    '[tabindex]',
    '[onclick]',
    '[contenteditable="true"]',
  ];

  const INTERACTIVE_TAGS = new Set([
    'a', 'button', 'input', 'select', 'textarea', 'details', 'summary'
  ]);

  function getRole(el) {
    if (el.getAttribute('role')) return el.getAttribute('role');
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type');
    if (tag === 'a') return 'link';
    if (tag === 'button' || (tag === 'input' && type === 'submit')) return 'button';
    if (tag === 'input') {
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'file') return 'file';
      if (type === 'search') return 'searchbox';
      return 'textbox';
    }
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'details') return 'group';
    if (tag === 'summary') return 'button';
    if (el.getAttribute('contenteditable') === 'true') return 'textbox';
    return tag;
  }

  function getLabel(el) {
    // aria-label takes priority
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    // aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return labelEl.textContent.trim();
    }

    // For inputs: placeholder, associated label, or name
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (el.id) {
        const label = document.querySelector('label[for="' + el.id + '"]');
        if (label) return label.textContent.trim();
      }
      if (el.placeholder) return el.placeholder;
      if (el.name) return el.name;
      if (el.title) return el.title;
      return '';
    }

    // Visible text (truncated)
    const text = el.textContent || '';
    return text.trim().substring(0, 80);
  }

  function isVisible(el) {
    if (!el.offsetParent && el.tagName.toLowerCase() !== 'body') {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (style.position !== 'fixed' && style.position !== 'sticky') return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getUniqueSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);

    const parts = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift('#' + CSS.escape(current.id));
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          s => s.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += ':nth-of-type(' + index + ')';
        }
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    if (parts[0] && !parts[0].startsWith('#')) {
      parts.unshift('body');
    }
    return parts.join(' > ');
  }

  function getXPath(el) {
    const parts = [];
    let current = el;
    while (current && current.nodeType === 1) {
      let index = 0;
      let sibling = current.previousSibling;
      while (sibling) {
        if (sibling.nodeType === 1 && sibling.tagName === current.tagName) index++;
        sibling = sibling.previousSibling;
      }
      const tag = current.tagName.toLowerCase();
      parts.unshift(tag + '[' + (index + 1) + ']');
      current = current.parentNode;
    }
    return '/' + parts.join('/');
  }

  // Collect all interactive elements
  const seen = new Set();
  const elements = [];

  const selectorStr = INTERACTIVE_SELECTORS.join(', ');
  for (const el of document.querySelectorAll(selectorStr)) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (!isVisible(el)) continue;

    const rect = el.getBoundingClientRect();
    elements.push({
      tag: el.tagName.toLowerCase(),
      role: getRole(el),
      text: getLabel(el),
      selector: getUniqueSelector(el),
      xpath: getXPath(el),
      visible: true,
      attributes: {},
      boundingBox: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    });
  }

  // Also find elements with cursor:pointer style
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    if (seen.has(el)) continue;
    if (INTERACTIVE_TAGS.has(el.tagName.toLowerCase())) continue;
    const style = window.getComputedStyle(el);
    if (style.cursor === 'pointer' && isVisible(el)) {
      seen.add(el);
      const rect = el.getBoundingClientRect();
      elements.push({
        tag: el.tagName.toLowerCase(),
        role: getRole(el),
        text: getLabel(el),
        selector: getUniqueSelector(el),
        xpath: getXPath(el),
        visible: true,
        attributes: {},
        boundingBox: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
    }
  }

  return JSON.stringify(elements);
})()
`;

/**
 * JavaScript to query ALL elements (not just interactive) for full snapshot
 */
export const QUERY_ALL_ELEMENTS_JS = `
(function() {
  function getRole(el) {
    if (el.getAttribute('role')) return el.getAttribute('role');
    const tag = el.tagName.toLowerCase();
    const headingMatch = tag.match(/^h([1-6])$/);
    if (headingMatch) return 'heading';
    if (tag === 'nav') return 'navigation';
    if (tag === 'main') return 'main';
    if (tag === 'aside') return 'complementary';
    if (tag === 'header') return 'banner';
    if (tag === 'footer') return 'contentinfo';
    if (tag === 'section') return 'region';
    if (tag === 'article') return 'article';
    if (tag === 'form') return 'form';
    if (tag === 'ul' || tag === 'ol') return 'list';
    if (tag === 'li') return 'listitem';
    if (tag === 'img') return 'img';
    if (tag === 'table') return 'table';
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'input') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'p') return 'paragraph';
    return tag;
  }

  function getText(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    // Direct text content (not from children)
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) text += node.textContent;
    }
    return text.trim().substring(0, 80);
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'br', 'hr', 'wbr', 'meta', 'link', 'template']);

  function buildTree(el, depth) {
    if (!el || !el.tagName) return [];
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return [];
    if (!isVisible(el)) return [];

    const role = getRole(el);
    const text = getText(el);
    const items = [];

    // Build attributes string
    const attrs = {};
    if (tag.match(/^h[1-6]$/)) attrs.level = tag[1];
    if (el.getAttribute('type')) attrs.type = el.getAttribute('type');
    if (el.getAttribute('href')) attrs.href = el.getAttribute('href').substring(0, 100);
    if (el.getAttribute('src')) attrs.src = el.getAttribute('src').substring(0, 100);
    if (el.getAttribute('alt')) attrs.alt = el.getAttribute('alt');
    if (el.disabled) attrs.disabled = 'true';
    if (el.checked) attrs.checked = 'true';
    if (el.value && (tag === 'input' || tag === 'textarea')) attrs.value = el.value.substring(0, 50);

    // Only include elements that have text or are structural
    const isStructural = ['heading', 'navigation', 'main', 'region', 'form', 'list', 'table', 'article', 'banner', 'contentinfo', 'complementary'].includes(role);
    const isInteractive = ['link', 'button', 'textbox', 'checkbox', 'radio', 'combobox', 'slider', 'file', 'searchbox', 'switch', 'tab', 'menuitem'].includes(role);

    if (text || isStructural || isInteractive || Object.keys(attrs).length > 0) {
      items.push({ tag, role, text, depth, attributes: attrs });
    }

    for (const child of el.children) {
      items.push(...buildTree(child, depth + 1));
    }
    return items;
  }

  const tree = buildTree(document.body, 0);
  return JSON.stringify(tree);
})()
`;

/**
 * Manages element references for a browser session
 */
export class RefManager {
  private refs: Map<string, ElementRef> = new Map();
  private counter = 0;
  private stale = false;

  /**
   * Clear all refs (called on navigation)
   */
  clear(): void {
    this.refs.clear();
    this.counter = 0;
    this.stale = true;
  }

  /**
   * Mark refs as fresh (after a new snapshot)
   */
  markFresh(): void {
    this.stale = false;
  }

  /**
   * Assign refs to a list of element metadata from the page
   */
  assign(elements: Array<{
    tag: string;
    role: string;
    text: string;
    selector: string;
    xpath: string;
    visible: boolean;
    attributes: Record<string, string>;
    boundingBox?: { x: number; y: number; width: number; height: number };
  }>): ElementRef[] {
    this.refs.clear();
    this.counter = 0;

    const result: ElementRef[] = [];
    for (const el of elements) {
      this.counter++;
      const ref = `@e${this.counter}`;
      const elementRef: ElementRef = {
        ref,
        selector: el.selector,
        xpath: el.xpath,
        tag: el.tag,
        role: el.role,
        text: el.text,
        boundingBox: el.boundingBox,
      };
      this.refs.set(ref, elementRef);
      result.push(elementRef);
    }

    this.stale = false;
    return result;
  }

  /**
   * Resolve a ref or CSS selector to a CSS selector
   */
  resolve(selectorOrRef: string): { selector: string; xpath: string } {
    if (selectorOrRef.startsWith("@e")) {
      if (this.stale) {
        throw new Error(
          `Ref ${selectorOrRef} is stale — page has navigated. Run 'snapshot' to get fresh refs.`
        );
      }
      const elementRef = this.refs.get(selectorOrRef);
      if (!elementRef) {
        const available = Array.from(this.refs.keys()).slice(0, 5).join(", ");
        throw new Error(
          `Ref ${selectorOrRef} not found. Available refs: ${available}${this.refs.size > 5 ? "..." : ""}`
        );
      }
      return { selector: elementRef.selector, xpath: elementRef.xpath };
    }
    // It's a CSS selector, pass through
    return { selector: selectorOrRef, xpath: "" };
  }

  /**
   * Get all current refs
   */
  getAll(): ElementRef[] {
    return Array.from(this.refs.values());
  }

  /**
   * Get a specific ref
   */
  get(ref: string): ElementRef | undefined {
    return this.refs.get(ref);
  }

  /**
   * Check if refs are stale
   */
  isStale(): boolean {
    return this.stale;
  }

  /**
   * Get ref count
   */
  get size(): number {
    return this.refs.size;
  }
}
