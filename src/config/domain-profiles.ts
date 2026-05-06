/**
 * Domain Profiles
 *
 * Per-domain scrape configuration overrides. Reader ships with NO
 * built-in profiles — the caller provides them via ScrapeOptions.domainProfiles.
 *
 * Profiles are merged with user-provided options — user options
 * take precedence. If a user explicitly sets a value, the profile
 * won't override it.
 */

import type { ScrapeOptions } from "../types";

/**
 * Subset of ScrapeOptions that can be overridden per domain
 */
export interface DomainProfile {
  /** Override proxy tier for this domain */
  proxyTier?: "datacenter" | "residential";
  /** Override timeout for this domain */
  timeoutMs?: number;
  /** Override batch concurrency (limit parallel requests to this domain) */
  batchConcurrency?: number;
  /** Minimum delay between requests in ms (for rate-sensitive sites) */
  minDelayMs?: number;
  /**
   * Tighten the per-proxy concurrency cap when scraping this domain.
   */
  maxConcurrentPerProxy?: number;
}

/**
 * Look up a domain profile by URL or hostname.
 *
 * @param urlOrHostname - Full URL or hostname
 * @param profiles - Domain profile map (from ScrapeOptions.domainProfiles)
 * @returns Domain profile if found, undefined otherwise
 */
export function getDomainProfile(
  urlOrHostname: string,
  profiles?: Record<string, DomainProfile>
): DomainProfile | undefined {
  if (!profiles || Object.keys(profiles).length === 0) return undefined;

  let hostname: string;
  try {
    hostname = urlOrHostname.includes("://") ? new URL(urlOrHostname).hostname : urlOrHostname;
  } catch {
    return undefined;
  }

  hostname = hostname.replace(/^www\./, "");

  // Exact match
  if (profiles[hostname]) {
    return profiles[hostname];
  }

  // Subdomain match (e.g., "shop.amazon.com" → "amazon.com")
  for (const domain of Object.keys(profiles)) {
    if (hostname.endsWith(`.${domain}`)) {
      return profiles[domain];
    }
  }

  return undefined;
}

/**
 * Merge a domain profile with user options.
 * User-provided options take precedence over profile values.
 */
export function applyDomainProfile<T extends Partial<ScrapeOptions>>(
  options: T,
  profile: DomainProfile
): T {
  const merged = { ...options };

  if (profile.timeoutMs && !options.timeoutMs) {
    merged.timeoutMs = profile.timeoutMs;
  }
  if (profile.batchConcurrency && !options.batchConcurrency) {
    merged.batchConcurrency = profile.batchConcurrency;
  }
  if (profile.proxyTier && !options.proxyTier) {
    merged.proxyTier = profile.proxyTier;
  }

  return merged;
}
