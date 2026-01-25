import type Hero from "@ulixee/hero";
import type { ChallengeDetection } from "./types";

/**
 * CHALLENGE-SPECIFIC DOM SELECTORS
 *
 * These are ONLY present during active challenges and disappear when complete.
 * No false positives - never appear on real content pages.
 */
const CHALLENGE_DOM_SELECTORS = [
  "#challenge-running",
  "#challenge-stage",
  "#challenge-form",
  ".cf-browser-verification",
];

/**
 * CHALLENGE-SPECIFIC TEXT PATTERNS
 *
 * These phrases only appear during active challenges.
 * They disappear completely when the challenge resolves.
 */
const CHALLENGE_TEXT_PATTERNS = [
  "verifying you are human",
  "checking if the site connection is secure",
  "this process is automatic. your browser will redirect",
];

/**
 * BLOCKED/403 SIGNALS
 *
 * Detect when access is explicitly denied
 */
const BLOCKED_SIGNALS = [
  "you have been blocked",
  "access to this page has been denied",
  "sorry, you have been blocked",
  "access denied",
  "403 forbidden",
];

/**
 * Detect if current page is a Cloudflare challenge
 *
 * Uses multi-signal approach with ONLY challenge-specific indicators.
 * No content length heuristics to avoid false positives.
 *
 * @param hero - Hero instance with loaded page
 * @returns Detection result with confidence score and signals
 *
 * @example
 * const detection = await detectChallenge(hero);
 * if (detection.isChallenge) {
 *   console.log(`Challenge detected: ${detection.type}`);
 *   console.log(`Signals: ${detection.signals.join(', ')}`);
 * }
 */
export async function detectChallenge(hero: Hero): Promise<ChallengeDetection> {
  const signals: string[] = [];
  let type: ChallengeDetection["type"] = "none";

  try {
    // Ensure we have access to document
    if (!hero.document) {
      return {
        isChallenge: false,
        type: "none",
        confidence: 0,
        signals: ["No document available"],
      };
    }

    const html = await hero.document.documentElement.outerHTML;
    const htmlLower = html.toLowerCase();

    // =========================================================================
    // CHECK 1: ACTIVE CHALLENGE DOM ELEMENTS
    // =========================================================================
    // These only exist during active challenges
    for (const selector of CHALLENGE_DOM_SELECTORS) {
      if (htmlLower.includes(selector.toLowerCase())) {
        signals.push(`Challenge element: ${selector}`);
        type = "js_challenge";
      }
    }

    // =========================================================================
    // CHECK 2: CHALLENGE-SPECIFIC TEXT
    // =========================================================================
    // These phrases only appear during active challenges
    for (const pattern of CHALLENGE_TEXT_PATTERNS) {
      if (htmlLower.includes(pattern)) {
        signals.push(`Challenge text: "${pattern}"`);
        type = type === "none" ? "js_challenge" : type;
      }
    }

    // =========================================================================
    // CHECK 3: "WAITING FOR" + "TO RESPOND"
    // =========================================================================
    // This specific combination only appears during challenges
    if (htmlLower.includes("waiting for") && htmlLower.includes("to respond")) {
      signals.push('Challenge text: "waiting for...to respond"');
      type = type === "none" ? "js_challenge" : type;
    }

    // =========================================================================
    // CHECK 4: BLOCKED/403 DETECTION
    // =========================================================================
    for (const pattern of BLOCKED_SIGNALS) {
      if (htmlLower.includes(pattern)) {
        signals.push(`Blocked: "${pattern}"`);
        type = "blocked";
        break; // One blocked signal is enough
      }
    }

    // Simple logic: If any signals found, it's a challenge
    const isChallenge = signals.length > 0;
    const confidence = isChallenge ? 100 : 0;

    return {
      isChallenge,
      type: isChallenge ? type : "none",
      confidence,
      signals,
    };
  } catch (error: any) {
    return {
      isChallenge: false,
      type: "none",
      confidence: 0,
      signals: [`Error during detection: ${error.message}`],
    };
  }
}

/**
 * Quick check - just returns boolean
 *
 * @param hero - Hero instance
 * @returns True if challenge page detected
 */
export async function isChallengePage(hero: Hero): Promise<boolean> {
  const detection = await detectChallenge(hero);
  return detection.isChallenge;
}
