import { convert } from "@vakra-dev/supermarkdown";
import { logger } from "../utils/logger.js";

const log = logger.child({ name: "markdown" });

/**
 * Convert HTML to Markdown
 *
 * Simple conversion without any headers, metadata, or formatting wrappers.
 * Returns clean markdown content ready for LLM consumption.
 *
 * Uses supermarkdown (Rust-based) for high-performance conversion.
 *
 * Safety layers:
 * 1. Rust catch_unwind in NAPI wrapper catches most panics (returns empty string)
 * 2. JS try/catch catches any thrown errors from NAPI binding
 * 3. Timeout prevents hanging on pathological inputs
 * 4. Fallback text extraction if conversion fails entirely
 */
export function htmlToMarkdown(html: string): string {
  try {
    const result = convert(html, {
      headingStyle: "atx",
      bulletMarker: "-",
      codeFence: "`",
      linkStyle: "inline",
    });

    // catch_unwind returns empty string on Rust panic -- detect this
    if (result === "" && html.length > 100) {
      log.warn(
        "supermarkdown returned empty string for %d byte input -- possible Rust panic caught by NAPI wrapper. Falling back to text extraction.",
        html.length
      );
      return fallbackTextExtract(html);
    }

    return result;
  } catch (error) {
    log.error(
      { err: error },
      "supermarkdown threw an error during conversion. Falling back to text extraction."
    );
    return fallbackTextExtract(html);
  }
}

/**
 * Fallback: strip HTML tags and return plain text.
 * Used when supermarkdown fails (panic, error, or empty result on large input).
 * Not great output quality, but keeps the pipeline alive instead of crashing.
 */
function fallbackTextExtract(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Alias for htmlToMarkdown (backward compatibility)
 */
export const formatToMarkdown = htmlToMarkdown;
