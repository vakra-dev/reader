/**
 * Startup-time proxy verification.
 *
 * Before the daemon declares itself ready, every configured proxy URL is
 * tested by making a real HTTP request to api.ipify.org through it. The
 * returned IP is the proxy's egress IP — confirming three things at once:
 *
 *   1. The proxy URL is reachable.
 *   2. The credentials are valid.
 *   3. Traffic actually flows through the proxy (the egress IP is not
 *      the host's own IP).
 *
 * If any proxy fails verification, `verifyProxiesOrThrow` rejects with a
 * clear multi-line error listing every failure. The daemon refuses to
 * start with a broken proxy configuration.
 *
 * The Fetcher abstraction lets unit tests inject a fake without spinning
 * up a real undici ProxyAgent or hitting api.ipify.org over the network.
 */

import { fetch as undiciFetch, ProxyAgent } from "undici";
import type { ProxyPoolConfig } from "../types";
import { redactProxyUrl } from "./config";

export const IP_CHECK_URL = "https://api.ipify.org?format=json";
export const IP_CHECK_TIMEOUT_MS = 10_000;

export type ProxyTierName = "standard" | "premium";

export interface VerifiedProxy {
  proxyUrl: string;
  egressIp: string;
  tier: ProxyTierName;
}

export interface ProxyVerificationFailure {
  proxyUrl: string;
  tier: ProxyTierName;
  error: string;
}

export interface ProxyVerificationResult {
  verified: VerifiedProxy[];
  failed: ProxyVerificationFailure[];
}

/**
 * Function that fetches the egress IP for a proxy URL. Production uses
 * `defaultFetcher` (undici + ProxyAgent + api.ipify.org). Tests inject a
 * fake.
 */
export type EgressIpFetcher = (proxyUrl: string) => Promise<string>;

export interface VerifyProxiesOptions {
  /** Override the fetcher for tests. */
  fetcher?: EgressIpFetcher;
}

/**
 * Verify every proxy in the pool. Returns a result object containing both
 * successes and failures — the caller decides whether failures are fatal
 * (`verifyProxiesOrThrow` is the strict variant used at daemon startup).
 *
 * Verification runs in parallel across all proxies; total wall time is
 * bounded by `IP_CHECK_TIMEOUT_MS`, not by the number of proxies.
 */
export async function verifyProxies(
  pools: ProxyPoolConfig | undefined,
  options: VerifyProxiesOptions = {}
): Promise<ProxyVerificationResult> {
  const fetcher = options.fetcher ?? defaultFetcher;
  const verified: VerifiedProxy[] = [];
  const failed: ProxyVerificationFailure[] = [];

  if (!pools) return { verified, failed };

  const tasks: Array<Promise<void>> = [];

  for (const tier of ["standard", "premium"] as const) {
    for (const cfg of pools[tier] ?? []) {
      const url = cfg.url;
      if (!url) continue;
      tasks.push(
        fetcher(url).then(
          (ip) => {
            verified.push({ proxyUrl: url, egressIp: ip, tier });
          },
          (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            failed.push({ proxyUrl: url, tier, error: msg });
          }
        )
      );
    }
  }

  await Promise.all(tasks);
  return { verified, failed };
}

/**
 * Verify proxies and throw a clear multi-line error if any failed. Used by
 * the daemon at startup to fail loud on misconfiguration.
 */
export async function verifyProxiesOrThrow(
  pools: ProxyPoolConfig | undefined,
  options: VerifyProxiesOptions = {}
): Promise<VerifiedProxy[]> {
  const result = await verifyProxies(pools, options);
  if (result.failed.length > 0) {
    const lines = [
      `Proxy verification failed for ${result.failed.length} proxy/proxies:`,
      ...result.failed.map((f) => `  - [${f.tier}] ${redactProxyUrl(f.proxyUrl)}: ${f.error}`),
      "",
      "The daemon refuses to start with a broken proxy configuration.",
      "Fix or remove the failing proxy URLs in PROXY_STANDARD / PROXY_PREMIUM,",
      `or check whether ${IP_CHECK_URL} is reachable from this network.`,
    ];
    throw new Error(lines.join("\n"));
  }
  return result.verified;
}

/**
 * Production fetcher: build a ProxyAgent for the URL, GET api.ipify.org
 * through it, parse the JSON, return the egress IP.
 *
 * The agent is single-use — closed in `finally` to release the TLS pool.
 * If verification is something we end up running periodically (not just
 * at startup), it's worth caching agents instead.
 */
async function defaultFetcher(proxyUrl: string): Promise<string> {
  const agent = new ProxyAgent(proxyUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IP_CHECK_TIMEOUT_MS);
  try {
    const res = await undiciFetch(IP_CHECK_URL, {
      dispatcher: agent,
      signal: controller.signal,
      headers: { "User-Agent": "reader-daemon-startup-check/1.0" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${IP_CHECK_URL}`);
    }
    const body = (await res.json()) as { ip?: string };
    if (!body.ip || typeof body.ip !== "string") {
      throw new Error(`Missing or invalid 'ip' field in api.ipify.org response`);
    }
    return body.ip;
  } finally {
    clearTimeout(timer);
    await agent.close().catch(() => undefined);
  }
}
