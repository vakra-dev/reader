/**
 * Environment-driven proxy pool configuration.
 *
 * Lets operators configure standard and premium proxy pools without
 * touching code — relevant for the daemon, which is run as a long-lived
 * process and gets its config from `.env`.
 *
 * Env vars:
 *   PROXY_STANDARD   - one URL, or comma-separated list of URLs
 *   PROXY_PREMIUM    - one URL, or comma-separated list of URLs
 *
 * Each URL must be of the form `http://user:pass@host:port`. Empty strings
 * and whitespace-only entries are ignored, so `PROXY_STANDARD=,` or an
 * unset var both resolve to "no proxies for that tier". An unparseable
 * URL throws at startup — we fail loud here rather than silently fall
 * through to direct connections, which would hide a misconfiguration
 * behind scrape results that look mostly fine until they get blocked.
 *
 * Returns `undefined` when no proxy env vars are set, so the caller can
 * distinguish "no proxies configured" (pass-through) from "empty pool".
 */

import type { ProxyPoolConfig, ProxyConfig } from "../types";
import { parseProxyUrl } from "./config";

/**
 * Parse a proxy entry which may include a timezone suffix: `url|timezone`
 * e.g. `http://user:pass@host:port|America/Los_Angeles`
 */
function parseList(raw: string | undefined, tierLabel: string): ProxyConfig[] {
  if (!raw) return [];
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return items.map((entry) => {
    // Split on last pipe to separate URL from optional timezone
    const pipeIdx = entry.lastIndexOf("|");
    const url = pipeIdx > 0 ? entry.slice(0, pipeIdx) : entry;
    const timezoneId = pipeIdx > 0 ? entry.slice(pipeIdx + 1) : undefined;

    try {
      const config = parseProxyUrl(url);
      if (timezoneId) config.timezoneId = timezoneId;
      return config;
    } catch (err) {
      throw new Error(
        `Invalid ${tierLabel} proxy URL (expected http://user:pass@host:port[|timezone]): ${entry}`
      );
    }
  });
}

export interface ParsedProxyPools {
  /** Undefined means no proxy env vars were set at all. */
  pools: ProxyPoolConfig | undefined;
  /** Human-readable summary for startup logging. */
  summary: string;
}

/**
 * Read PROXY_STANDARD and PROXY_PREMIUM from `env` (defaults to
 * `process.env`) and build a ProxyPoolConfig.
 */
export function parseProxyPoolsFromEnv(env: NodeJS.ProcessEnv = process.env): ParsedProxyPools {
  const standard = parseList(env.PROXY_STANDARD, "standard");
  const premium = parseList(env.PROXY_PREMIUM, "premium");

  if (standard.length === 0 && premium.length === 0) {
    return {
      pools: undefined,
      summary: "no proxies configured — scrapes go direct",
    };
  }

  return {
    pools: {
      ...(standard.length > 0 ? { standard } : {}),
      ...(premium.length > 0 ? { premium } : {}),
    },
    summary: `proxies loaded: ${standard.length} standard, ${premium.length} premium`,
  };
}
