import type Hero from "@ulixee/hero";
import { detectChallenge } from "./detector";
import type { ChallengeResolutionResult, ChallengeWaitOptions } from "./types";

/**
 * Wait for Cloudflare challenge to resolve
 *
 * Uses multiple detection strategies:
 * 1. URL redirect detection (page redirects after challenge)
 * 2. Signal polling (challenge-specific elements/text disappear)
 *
 * @param hero - Hero instance with challenge page loaded
 * @param options - Waiting options
 * @returns Resolution result with method and time waited
 *
 * @example
 * const result = await waitForChallengeResolution(hero, {
 *   maxWaitMs: 45000,
 *   pollIntervalMs: 500,
 *   verbose: true,
 *   initialUrl: 'https://example.com'
 * });
 *
 * if (result.resolved) {
 *   console.log(`Challenge resolved via ${result.method} in ${result.waitedMs}ms`);
 * }
 */
export async function waitForChallengeResolution(
  hero: Hero,
  options: ChallengeWaitOptions
): Promise<ChallengeResolutionResult> {
  const { maxWaitMs = 45000, pollIntervalMs = 500, verbose = false, initialUrl } = options;

  const startTime = Date.now();
  const log = (msg: string) => verbose && console.log(`   ${msg}`);

  while (Date.now() - startTime < maxWaitMs) {
    const elapsed = Date.now() - startTime;

    // =========================================================================
    // STRATEGY 1: Check for URL change (redirect after challenge)
    // =========================================================================
    try {
      const currentUrl = await hero.url;
      if (currentUrl !== initialUrl) {
        log(`✓ URL changed: ${initialUrl} → ${currentUrl}`);
        // Wait for the new page to fully load after redirect
        log(`  Waiting for new page to load...`);
        try {
          await hero.waitForLoad("DomContentLoaded", { timeoutMs: 30000 });
          log(`  DOMContentLoaded`);
        } catch {
          log(`  DOMContentLoaded timeout, continuing...`);
        }
        // Additional wait for JS to execute and render
        await hero.waitForPaintingStable().catch(() => {});
        log(`  Page stabilized`);
        return { resolved: true, method: "url_redirect", waitedMs: elapsed };
      }
    } catch {
      // URL check failed, continue with other strategies
    }

    // =========================================================================
    // STRATEGY 2: Check if challenge signals are gone
    // =========================================================================
    const detection = await detectChallenge(hero);

    if (!detection.isChallenge) {
      log(`✓ Challenge signals cleared (confidence dropped to ${detection.confidence})`);
      // Wait for page to fully load after challenge clears
      log(`  Waiting for page to load...`);
      try {
        await hero.waitForLoad("DomContentLoaded", { timeoutMs: 30000 });
        log(`  DOMContentLoaded`);
      } catch {
        log(`  DOMContentLoaded timeout, continuing...`);
      }
      await hero.waitForPaintingStable().catch(() => {});
      log(`  Page stabilized`);
      return { resolved: true, method: "signals_cleared", waitedMs: elapsed };
    }

    // Log progress
    log(
      `⏳ ${(elapsed / 1000).toFixed(1)}s - Still challenge (confidence: ${detection.confidence})`
    );

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Timeout reached
  return {
    resolved: false,
    method: "timeout",
    waitedMs: Date.now() - startTime,
  };
}

/**
 * Wait for a specific CSS selector to appear
 *
 * Useful when you know exactly what element should appear after challenge.
 *
 * @param hero - Hero instance
 * @param selector - CSS selector to wait for
 * @param maxWaitMs - Maximum time to wait
 * @param verbose - Enable logging
 * @returns Whether selector was found and time waited
 *
 * @example
 * const result = await waitForSelector(hero, '.content', 30000, true);
 * if (result.found) {
 *   console.log(`Content appeared after ${result.waitedMs}ms`);
 * }
 */
export async function waitForSelector(
  hero: Hero,
  selector: string,
  maxWaitMs: number,
  verbose: boolean = false
): Promise<{ found: boolean; waitedMs: number }> {
  const startTime = Date.now();
  const log = (msg: string) => verbose && console.log(`   ${msg}`);

  log(`Waiting for selector: "${selector}"`);

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const element = await hero.document.querySelector(selector);
      if (element) {
        const elapsed = Date.now() - startTime;
        log(`✓ Selector found after ${(elapsed / 1000).toFixed(1)}s`);
        return { found: true, waitedMs: elapsed };
      }
    } catch {
      // Selector not found yet, continue
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  log(`✗ Selector not found within timeout`);
  return { found: false, waitedMs: Date.now() - startTime };
}

/**
 * Handle Cloudflare challenge with automatic detection and waiting
 *
 * High-level function that combines detection and resolution.
 *
 * @param hero - Hero instance
 * @param options - Wait options (without initialUrl)
 * @returns Resolution result
 *
 * @example
 * await hero.goto('https://example.com');
 * const result = await handleChallenge(hero, { verbose: true });
 * if (result.resolved) {
 *   // Challenge passed, continue scraping
 * }
 */
export async function handleChallenge(
  hero: Hero,
  options: Omit<ChallengeWaitOptions, "initialUrl"> = {}
): Promise<ChallengeResolutionResult> {
  // Get current URL
  const initialUrl = await hero.url;

  // Detect challenge
  const detection = await detectChallenge(hero);

  if (!detection.isChallenge) {
    // No challenge, return immediately
    return { resolved: true, method: "signals_cleared", waitedMs: 0 };
  }

  // Challenge detected, wait for resolution
  return waitForChallengeResolution(hero, {
    ...options,
    initialUrl,
  });
}
