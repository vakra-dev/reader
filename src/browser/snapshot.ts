/**
 * Snapshot Builder
 *
 * Builds accessibility/DOM tree text with @e refs assigned to elements.
 * Supports interactive-only filtering, CSS selector scoping, and
 * unified diff against previous snapshots.
 */

import type { ElementRef, SnapshotOptions } from "./types.js";

/**
 * Element from the page query (before ref assignment)
 */
export interface RawElement {
  tag: string;
  role: string;
  text: string;
  depth?: number;
  attributes: Record<string, string>;
  selector?: string;
  xpath?: string;
  visible?: boolean;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

const INTERACTIVE_ROLES = new Set([
  "link",
  "button",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "slider",
  "file",
  "searchbox",
  "switch",
  "tab",
  "menuitem",
  "spinbutton",
]);

/**
 * Format a snapshot tree element into a single text line
 */
function formatElementLine(
  el: RawElement,
  ref?: string,
  indent: number = 0
): string {
  const pad = "  ".repeat(indent);
  const parts: string[] = [];

  // Ref (if assigned)
  if (ref) {
    parts.push(ref);
  }

  // Role in brackets
  parts.push(`[${el.role}]`);

  // Text in quotes (if non-empty)
  if (el.text) {
    parts.push(`"${el.text}"`);
  }

  // Attributes in brackets
  const attrParts: string[] = [];
  for (const [key, value] of Object.entries(el.attributes)) {
    if (key === "href" || key === "src") {
      attrParts.push(`${key}=${value}`);
    } else {
      attrParts.push(`${key}=${value}`);
    }
  }
  if (attrParts.length > 0) {
    parts.push(`[${attrParts.join(", ")}]`);
  }

  return `${pad}${parts.join(" ")}`;
}

/**
 * Build snapshot text from interactive elements with refs
 */
export function buildInteractiveSnapshot(refs: ElementRef[]): string {
  const lines: string[] = [];
  for (const ref of refs) {
    const attrs: Record<string, string> = {};
    const el: RawElement = {
      tag: ref.tag,
      role: ref.role,
      text: ref.text,
      attributes: attrs,
    };
    lines.push(formatElementLine(el, ref.ref, 0));
  }
  return lines.join("\n");
}

/**
 * Build snapshot text from full DOM tree elements
 */
export function buildFullSnapshot(
  elements: RawElement[],
  refs: ElementRef[],
  options?: SnapshotOptions
): string {
  // Create ref lookup by selector
  const refBySelector = new Map<string, string>();
  for (const ref of refs) {
    refBySelector.set(ref.selector, ref.ref);
  }

  const lines: string[] = [];
  for (const el of elements) {
    // Filter interactive only
    if (options?.interactive && !INTERACTIVE_ROLES.has(el.role)) {
      continue;
    }

    const ref = el.selector ? refBySelector.get(el.selector) : undefined;
    const depth = el.depth ?? 0;
    lines.push(formatElementLine(el, ref, depth));
  }

  return lines.join("\n");
}

/**
 * Compute a unified diff between two snapshot texts
 */
export function computeSnapshotDiff(
  oldText: string,
  newText: string
): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Simple line-by-line diff
  const result: string[] = [];

  // Use a basic LCS-based diff
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  // Lines removed (in old but not in new)
  const removed = oldLines.filter((line) => !newSet.has(line));
  // Lines added (in new but not in old)
  const added = newLines.filter((line) => !oldSet.has(line));

  if (removed.length === 0 && added.length === 0) {
    return "(no changes)";
  }

  result.push(`--- previous snapshot`);
  result.push(`+++ current snapshot`);
  result.push(`@@ -1,${oldLines.length} +1,${newLines.length} @@`);

  for (const line of removed) {
    result.push(`- ${line}`);
  }
  for (const line of added) {
    result.push(`+ ${line}`);
  }

  return result.join("\n");
}
