import type Hero from "@ulixee/hero";
import type { ChallengeDetection } from "./types";

/**
 * CLOUDFLARE-SPECIFIC DOM SELECTORS
 *
 * These are ONLY present during active Cloudflare challenges.
 * We query for actual DOM elements, not string matching.
 */
const CLOUDFLARE_CHALLENGE_SELECTORS = [
  "#challenge-running",
  "#challenge-stage",
  "#challenge-form",
  ".cf-browser-verification",
  "#cf-wrapper",
  "#cf-hcaptcha-container",
  "#turnstile-wrapper",
];

/**
 * CLOUDFLARE-SPECIFIC TEXT PATTERNS
 *
 * These phrases only appear during active Cloudflare challenges.
 * Must be combined with other Cloudflare signals to avoid false positives.
 */
const CLOUDFLARE_TEXT_PATTERNS = [
  "checking if the site connection is secure",
  "this process is automatic. your browser will redirect",
  "ray id:",
  "performance & security by cloudflare",
];

/**
 * CLOUDFLARE INFRASTRUCTURE SIGNALS
 *
 * Indicators that the page is served by Cloudflare
 */
const CLOUDFLARE_INFRA_PATTERNS = [
  "/cdn-cgi/",
  "cloudflare",
  "__cf_bm",
  "cf-ray",
];

/**
 * BLOCKED/403 SIGNALS (Cloudflare-specific)
 *
 * Detect when Cloudflare explicitly blocks access
 */
const CLOUDFLARE_BLOCKED_PATTERNS = [
  "sorry, you have been blocked",
  "ray id:",
];

/**
 * Detect if current page is a Cloudflare challenge
 *
 * Uses multi-signal approach requiring BOTH:
 * 1. Cloudflare infrastructure indicators (cdn-cgi, cf-ray, etc.)
 * 2. Challenge-specific elements or text
 *
 * This prevents false positives on login pages or other sites
 * that happen to use similar text.
 *
 * @param hero - Hero instance with loaded page
 * @returns Detection result with confidence score and signals
 */
export async function detectChallenge(hero: Hero): Promise<ChallengeDetection> {
  const signals: string[] = [];
  let type: ChallengeDetection["type"] = "none";
  let hasCloudflareInfra = false;
  let hasChallengeIndicator = false;

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

    // =========================================================================
    // CHECK 1: CLOUDFLARE INFRASTRUCTURE (required for any detection)
    // =========================================================================
    const html = await hero.document.documentElement.outerHTML;
    const htmlLower = html.toLowerCase();

    for (const pattern of CLOUDFLARE_INFRA_PATTERNS) {
      if (htmlLower.includes(pattern)) {
        hasCloudflareInfra = true;
        signals.push(`Cloudflare infra: "${pattern}"`);
        break;
      }
    }

    // If no Cloudflare infrastructure detected, it's not a Cloudflare challenge
    if (!hasCloudflareInfra) {
      return {
        isChallenge: false,
        type: "none",
        confidence: 0,
        signals: ["No Cloudflare infrastructure detected"],
      };
    }

    // =========================================================================
    // CHECK 2: CHALLENGE DOM ELEMENTS (using actual DOM queries)
    // =========================================================================
    for (const selector of CLOUDFLARE_CHALLENGE_SELECTORS) {
      try {
        const element = await hero.document.querySelector(selector);
        if (element) {
          hasChallengeIndicator = true;
          signals.push(`Challenge element: ${selector}`);
          type = "js_challenge";
        }
      } catch {
        // Element not found, continue
      }
    }

    // =========================================================================
    // CHECK 3: CHALLENGE-SPECIFIC TEXT
    // =========================================================================
    for (const pattern of CLOUDFLARE_TEXT_PATTERNS) {
      if (htmlLower.includes(pattern)) {
        hasChallengeIndicator = true;
        signals.push(`Challenge text: "${pattern}"`);
        type = type === "none" ? "js_challenge" : type;
      }
    }

    // =========================================================================
    // CHECK 4: "WAITING FOR" + "TO RESPOND" (Cloudflare-specific combo)
    // =========================================================================
    if (htmlLower.includes("waiting for") && htmlLower.includes("to respond")) {
      hasChallengeIndicator = true;
      signals.push('Challenge text: "waiting for...to respond"');
      type = type === "none" ? "js_challenge" : type;
    }

    // =========================================================================
    // CHECK 5: CLOUDFLARE BLOCKED DETECTION
    // =========================================================================
    // Check for blocked page with Ray ID (Cloudflare-specific)
    const hasBlocked = CLOUDFLARE_BLOCKED_PATTERNS.every((p) => htmlLower.includes(p));
    if (hasBlocked) {
      hasChallengeIndicator = true;
      signals.push("Cloudflare block page detected");
      type = "blocked";
    }

    // Challenge only if we have BOTH Cloudflare infra AND challenge indicators
    const isChallenge = hasCloudflareInfra && hasChallengeIndicator;
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
