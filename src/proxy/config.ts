import type { ProxyConfig } from "../types";

/**
 * Create proxy URL from configuration
 *
 * Supports both standard and premium proxies.
 * For premium proxies, generates a sticky session ID.
 *
 * @param config - Proxy configuration
 * @returns Formatted proxy URL
 *
 * @example
 * // Standard proxy
 * createProxyUrl({
 *   type: 'standard',
 *   username: 'user',
 *   password: 'pass',
 *   host: 'proxy.example.com',
 *   port: 8080
 * })
 * // Returns: "http://user:pass@proxy.example.com:8080"
 */
export function createProxyUrl(config: ProxyConfig): string {
  // If full URL provided, use it directly
  if (config.url) {
    return config.url;
  }

  // Premium proxy with sticky session
  if (config.type === "premium") {
    // Generate unique session ID for sticky sessions
    const sessionId = `reader_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Format: customer-{username}_session-{sessionId}_country-{country}:{password}@{host}:{port}
    return `http://customer-${config.username}_session-${sessionId}_country-${
      config.country || "us"
    }:${config.password}@${config.host}:${config.port}`;
  }

  // Standard proxy (simple authentication)
  return `http://${config.username}:${config.password}@${config.host}:${config.port}`;
}

/**
 * Parse proxy URL into ProxyConfig
 *
 * @param url - Proxy URL string
 * @returns Parsed proxy configuration
 *
 * @example
 * parseProxyUrl("http://user:pass@proxy.example.com:8080")
 * // Returns: { username: 'user', password: 'pass', host: 'proxy.example.com', port: 8080 }
 */
/**
 * Redact credentials from a proxy URL for logging. `http://user:pass@host:port`
 * becomes `http://***@host:port`. Never log the raw URL -- it contains secrets.
 */
export function redactProxyUrl(proxyUrl: string | null): string {
  if (!proxyUrl) return "direct";
  try {
    const u = new URL(proxyUrl);
    const creds = u.username ? "***@" : "";
    return `${u.protocol}//${creds}${u.host}`;
  } catch {
    return "<invalid-proxy-url>";
  }
}

export function parseProxyUrl(url: string): ProxyConfig {
  try {
    const parsed = new URL(url);

    return {
      url,
      username: parsed.username,
      password: parsed.password,
      host: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : undefined,
    };
  } catch (error) {
    throw new Error(`Invalid proxy URL: ${url}`);
  }
}
