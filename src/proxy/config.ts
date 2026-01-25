import type { ProxyConfig } from "../types";

/**
 * Create proxy URL from configuration
 *
 * Supports both datacenter and residential proxies.
 * For residential proxies (e.g., IPRoyal), generates a sticky session ID.
 *
 * @param config - Proxy configuration
 * @returns Formatted proxy URL
 *
 * @example
 * // Datacenter proxy
 * createProxyUrl({
 *   type: 'datacenter',
 *   username: 'user',
 *   password: 'pass',
 *   host: 'proxy.example.com',
 *   port: 8080
 * })
 * // Returns: "http://user:pass@proxy.example.com:8080"
 *
 * @example
 * // Residential proxy with sticky session
 * createProxyUrl({
 *   type: 'residential',
 *   username: 'customer-abc',
 *   password: 'secret',
 *   host: 'geo.iproyal.com',
 *   port: 12321,
 *   country: 'us'
 * })
 * // Returns: "http://customer-abc_session-hero_123_abc456_country-us:secret@geo.iproyal.com:12321"
 */
export function createProxyUrl(config: ProxyConfig): string {
  // If full URL provided, use it directly
  if (config.url) {
    return config.url;
  }

  // Residential proxy with sticky session
  if (config.type === "residential") {
    // Generate unique session ID for sticky sessions
    const sessionId = `hero_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Format: customer-{username}_session-{sessionId}_country-{country}:{password}@{host}:{port}
    return `http://customer-${config.username}_session-${sessionId}_country-${
      config.country || "us"
    }:${config.password}@${config.host}:${config.port}`;
  }

  // Datacenter proxy (simple authentication)
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
