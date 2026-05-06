/**
 * Environment-driven proxy pool configuration.
 *
 * Lets operators configure datacenter and residential proxy pools without
 * touching code — relevant for the daemon, which is run as a long-lived
 * process and gets its config from `.env`.
 *
 * Env vars:
 *   PROXY_DATACENTER   - one URL, or comma-separated list of URLs
 *   PROXY_RESIDENTIAL  - one URL, or comma-separated list of URLs
 *
 * Each URL must be of the form `http://user:pass@host:port`. Empty strings
 * and whitespace-only entries are ignored, so `PROXY_DATACENTER=,` or an
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
 * Read PROXY_DATACENTER and PROXY_RESIDENTIAL from `env` (defaults to
 * `process.env`) and build a ProxyPoolConfig.
 */
export function parseProxyPoolsFromEnv(env: NodeJS.ProcessEnv = process.env): ParsedProxyPools {
  const datacenter = parseList(env.PROXY_DATACENTER, "datacenter");
  const residential = parseList(env.PROXY_RESIDENTIAL, "residential");

  if (datacenter.length === 0 && residential.length === 0) {
    return {
      pools: undefined,
      summary: "no proxies configured — scrapes go direct",
    };
  }

  return {
    pools: {
      ...(datacenter.length > 0 ? { datacenter } : {}),
      ...(residential.length > 0 ? { residential } : {}),
    },
    summary: `proxies loaded: ${datacenter.length} datacenter, ${residential.length} residential`,
  };
}
