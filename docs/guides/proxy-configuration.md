# Proxy Configuration Guide

This guide covers proxy setup for Reader.

## Overview

Proxies help with:
- Bypassing IP-based blocks
- Accessing geo-restricted content
- Distributing requests across multiple IPs
- Avoiding rate limits

## Quick Start

### Using Proxy URL

```typescript
const reader = new ReaderClient();
const result = await reader.scrape({
  urls: ["https://example.com"],
  proxy: {
    url: "http://username:password@proxy.example.com:8080",
  },
});
await reader.close();
```

### Using Structured Config

```typescript
const reader = new ReaderClient();
const result = await reader.scrape({
  urls: ["https://example.com"],
  proxy: {
    type: "residential",
    host: "proxy.example.com",
    port: 8080,
    username: "username",
    password: "password",
    country: "us",
  },
});
await reader.close();
```

### CLI Usage

```bash
npx reader scrape https://example.com --proxy http://user:pass@host:port
```

## Proxy Types

### Datacenter Proxies

- **Pros:** Fast, cheap, reliable
- **Cons:** Easily detected, often blocked
- **Best for:** Sites without bot protection

```typescript
proxy: {
  type: "datacenter",
  host: "proxy.example.com",
  port: 8080,
  username: "username",
  password: "password",
}
```

### Residential Proxies

- **Pros:** Real IPs, hard to detect, trusted by Cloudflare
- **Cons:** Slower, more expensive, limited bandwidth
- **Best for:** Cloudflare-protected sites, sensitive scraping

```typescript
proxy: {
  type: "residential",
  host: "proxy.example.com",
  port: 8080,
  username: "username",
  password: "password",
  country: "us",
}
```

### Mobile Proxies

- **Pros:** Highest trust level, shared by many users
- **Cons:** Most expensive, limited availability
- **Best for:** Most aggressive anti-bot systems

## Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `url` | `string` | Full proxy URL (takes precedence) |
| `type` | `"datacenter" \| "residential"` | Proxy type |
| `host` | `string` | Proxy server hostname |
| `port` | `number` | Proxy server port |
| `username` | `string` | Authentication username |
| `password` | `string` | Authentication password |
| `country` | `string` | Country code (e.g., "us", "uk", "de") |

## Provider Examples

### IPRoyal

```typescript
proxy: {
  type: "residential",
  host: "geo.iproyal.com",
  port: 12321,
  username: "customer-username",
  password: "password",
  country: "us",
}
```

### Bright Data (Luminati)

```typescript
proxy: {
  type: "residential",
  host: "brd.superproxy.io",
  port: 22225,
  username: "customer-zone-residential",
  password: "password",
  country: "us",
}
```

### Oxylabs

```typescript
proxy: {
  type: "residential",
  host: "pr.oxylabs.io",
  port: 7777,
  username: "customer-username",
  password: "password",
  country: "us",
}
```

### SmartProxy

```typescript
proxy: {
  type: "residential",
  host: "gate.smartproxy.com",
  port: 7000,
  username: "user",
  password: "pass",
  country: "us",
}
```

## Proxy Pooling

Reader supports built-in proxy pooling with automatic rotation:

```typescript
const reader = new ReaderClient({
  // Configure multiple proxies
  proxies: [
    { host: "proxy1.example.com", port: 8080, username: "user", password: "pass" },
    { host: "proxy2.example.com", port: 8080, username: "user", password: "pass" },
    { host: "proxy3.example.com", port: 8080, username: "user", password: "pass", country: "us" },
  ],
  // Rotation strategy: "round-robin" (default) or "random"
  proxyRotation: "round-robin",
});

// Each request automatically uses the next proxy in rotation
const result = await reader.scrape({
  urls: ["https://example1.com", "https://example2.com", "https://example3.com"],
});

// Check which proxy handled each request
result.data.forEach((site) => {
  console.log(`${site.metadata.baseUrl} -> ${site.metadata.proxy?.host}:${site.metadata.proxy?.port}`);
});

await reader.close();
```

### Proxy Metadata in Response

When using proxy pooling, each result includes metadata about which proxy was used:

```typescript
interface ProxyMetadata {
  host: string;    // Proxy host that handled the request
  port: number;    // Proxy port
  country?: string; // Country code if geo-targeting was used
}
```

## Rotation Strategies

### Per-Request Rotation

Most residential proxy providers rotate IPs automatically:

```typescript
const reader = new ReaderClient();

// Each request gets a different IP
for (const url of urls) {
  await reader.scrape({
    urls: [url],
    proxy: proxyConfig,
  });
}

await reader.close();
```

### Sticky Sessions

Keep the same IP for multiple requests:

```typescript
// Some providers support session IDs
proxy: {
  host: "proxy.example.com",
  port: 8080,
  username: "user-session-abc123",  // Session in username
  password: "pass",
}
```

### Manual Rotation

Rotate through a list of proxies:

```typescript
const proxies = [
  { host: "proxy1.example.com", port: 8080 },
  { host: "proxy2.example.com", port: 8080 },
  { host: "proxy3.example.com", port: 8080 },
];

let proxyIndex = 0;
const reader = new ReaderClient();

async function scrapeWithRotation(url: string) {
  const proxy = proxies[proxyIndex % proxies.length];
  proxyIndex++;

  return await reader.scrape({
    urls: [url],
    proxy: {
      ...proxy,
      username: "username",
      password: "password",
    },
  });
}

// Don't forget to close when done
// await reader.close();
```

## Geo-Targeting

Target specific countries for localized content:

```typescript
const reader = new ReaderClient();

// US content
const usResult = await reader.scrape({
  urls: ["https://example.com"],
  proxy: { ...baseProxy, country: "us" },
});

// UK content
const ukResult = await reader.scrape({
  urls: ["https://example.com"],
  proxy: { ...baseProxy, country: "uk" },
});

await reader.close();
```

Common country codes:
- `us` - United States
- `uk` or `gb` - United Kingdom
- `de` - Germany
- `fr` - France
- `jp` - Japan
- `au` - Australia

## Error Handling

### Proxy Failures

```typescript
const reader = new ReaderClient();

async function scrapeWithFallback(url: string) {
  const proxies = [residentialProxy, datacenterProxy, null];

  for (const proxy of proxies) {
    try {
      return await reader.scrape({
        urls: [url],
        proxy,
        timeoutMs: 30000,
      });
    } catch (error) {
      console.log(`Proxy failed: ${proxy?.host || "direct"}`);
      continue;
    }
  }

  throw new Error("All proxies failed");
}

// Don't forget to close when done
// await reader.close();
```

### Connection Errors

Common proxy errors and solutions:

| Error | Cause | Solution |
|-------|-------|----------|
| `ECONNREFUSED` | Proxy server down | Try different proxy |
| `407 Proxy Auth Required` | Wrong credentials | Check username/password |
| `403 Forbidden` | Proxy blocked by site | Use residential proxy |
| `Timeout` | Slow proxy | Increase timeout |

## Testing Proxies

### Verify Proxy Works

```typescript
const reader = new ReaderClient();

async function testProxy(proxy: ProxyConfig): Promise<boolean> {
  try {
    const result = await reader.scrape({
      urls: ["https://httpbin.org/ip"],
      formats: ["text"],
      proxy,
      timeoutMs: 10000,
    });

    console.log("Proxy IP:", result.data[0].text);
    return true;
  } catch (error) {
    console.log("Proxy failed:", error.message);
    return false;
  }
}

await reader.close();
```

### Check Geo-Location

```typescript
const reader = new ReaderClient();

const result = await reader.scrape({
  urls: ["https://ipinfo.io/json"],
  formats: ["json"],
  proxy: { ...proxyConfig, country: "uk" },
});

const info = JSON.parse(result.data[0].json);
console.log("Country:", info.country);  // Should be "GB"

await reader.close();
```

## Best Practices

1. **Start with datacenter proxies** - Cheaper, see if you need more
2. **Upgrade to residential** - When blocked or for Cloudflare sites
3. **Use geo-targeting** - Match target site's expected users
4. **Implement rotation** - Spread requests across IPs
5. **Handle failures gracefully** - Have fallback proxies
6. **Monitor bandwidth** - Residential proxies charge by GB
7. **Test before deploying** - Verify proxies work with target site

## Cost Considerations

| Proxy Type | Typical Cost | Best For |
|------------|--------------|----------|
| Datacenter | $0.50-2/GB | Unprotected sites |
| Residential | $3-15/GB | Cloudflare, sensitive sites |
| Mobile | $20-50/GB | Highest security sites |

## Related Guides

- [Cloudflare Bypass](cloudflare-bypass.md) - Works best with residential proxies
- [Browser Pool](browser-pool.md) - Managing browser instances
- [Troubleshooting](../troubleshooting.md) - Common proxy issues
