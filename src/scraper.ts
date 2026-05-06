import pLimit from "p-limit";
import { htmlToMarkdown } from "./formatters/markdown";
import { postprocessMarkdown } from "./formatters/postprocess";
import { cleanContent } from "./utils/content-cleaner";
import { extractMetadata } from "./utils/metadata-extractor";
import { createLogger } from "./utils/logger";
import { fetchRobotsTxt, isUrlAllowed, type RobotsRules } from "./utils/robots-parser";
import {
  DEFAULT_OPTIONS,
  type ScrapeOptions,
  type ScrapeResult,
  type WebsiteScrapeResult,
  type BatchMetadata,
  type ProxyMetadata,
  type ProxyTier,
} from "./types";
import { EngineOrchestrator, ScrapeFailedError } from "./engines/index.js";
import { getDomainProfile, applyDomainProfile } from "./config/domain-profiles.js";
import { isBlockedResponse } from "./utils/block-detector.js";
import { rewriteUrl } from "./utils/url-rewriter.js";
import {
  wrapError,
  ReaderError,
  DNSError,
  RobotsBlockedError,
  InvalidUrlError,
  ProxyConnectionError,
} from "./errors.js";
import type { PerProxyGate } from "./proxy/proxy-gate.js";
import type { ProxyHealthTracker } from "./proxy/health-tracker.js";
import { redactProxyUrl } from "./browser/proxy-bound-browser.js";

/** Default hard deadline for any single URL (ms). */
const DEFAULT_HARD_DEADLINE_MS = 30_000;

/** Default timeout for the first datacenter proxy attempt (ms). */
const DEFAULT_DATACENTER_TIMEOUT_MS = 10_000;

/**
 * Scraper class with built-in concurrency and proxy escalation.
 *
 * Retry strategy per URL:
 *   1. Hero on datacenter proxy, 10s timeout
 *   2. Any failure → Hero on residential proxy, remaining time (up to 30s total)
 *   3. Any failure → done, report error
 *
 * Non-retryable errors (DNS, invalid URL, robots.txt) skip directly to failure.
 */
export class Scraper {
  private options: Required<ScrapeOptions>;
  private logger = createLogger("scraper");
  private robotsCache: Map<string, RobotsRules | null> = new Map();

  constructor(options: ScrapeOptions) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    } as Required<ScrapeOptions>;
  }

  /**
   * Get robots.txt rules for a URL, cached per domain
   */
  private async getRobotsRules(url: string): Promise<RobotsRules | null> {
    const origin = new URL(url).origin;
    if (!this.robotsCache.has(origin)) {
      const rules = await fetchRobotsTxt(origin);
      this.robotsCache.set(origin, rules);
    }
    return this.robotsCache.get(origin) ?? null;
  }

  /**
   * Scrape all URLs
   */
  async scrape(): Promise<ScrapeResult> {
    const startTime = Date.now();
    const results = await this.scrapeWithConcurrency();
    return this.buildScrapeResult(results, startTime);
  }

  /**
   * Scrape URLs with concurrency control
   */
  private async scrapeWithConcurrency(): Promise<
    Array<{ result: WebsiteScrapeResult | null; error?: string }>
  > {
    const limit = pLimit(this.options.batchConcurrency || 1);
    const tasks = this.options.urls.map((url, index) =>
      limit(() => this.scrapeSingleUrlWithRetry(url, index))
    );

    const batchPromise = Promise.all(tasks);

    if (this.options.batchTimeoutMs && this.options.batchTimeoutMs > 0) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Batch operation timed out after ${this.options.batchTimeoutMs}ms`));
        }, this.options.batchTimeoutMs);
      });

      return Promise.race([batchPromise, timeoutPromise]);
    }

    return batchPromise;
  }

  /**
   * Scrape a single URL with proxy escalation.
   *
   *   1. Try datacenter proxy with 10s timeout
   *   2. On ANY failure (timeout, empty, blocked, error) → residential with remaining time
   *   3. On failure → done
   */
  private async scrapeSingleUrlWithRetry(
    url: string,
    index: number
  ): Promise<{ result: WebsiteScrapeResult | null; error?: string }> {
    const hardDeadlineMs = this.options.hardDeadlineMs ?? DEFAULT_HARD_DEADLINE_MS;
    const datacenterTimeoutMs = this.options.datacenterTimeoutMs ?? DEFAULT_DATACENTER_TIMEOUT_MS;
    const deadline = Date.now() + hardDeadlineMs;

    // If domain profile or caller specifies residential, skip datacenter attempt entirely
    const domainProfile = getDomainProfile(url, this.options.domainProfiles);
    const profileTier = domainProfile?.proxyTier ?? this.options.proxyTier;
    if (profileTier === "residential") {
      try {
        const result = await this.scrapeSingleUrl(url, index, "residential", hardDeadlineMs);
        if (result) return { result };
      } catch (error: any) {
        this.logger.error(`[scraper] Residential attempt failed for ${url}: ${error.message}`);
        return { result: null, error: error.message };
      }
      return { result: null, error: `Residential scrape returned no data for ${url}` };
    }

    // --- Attempt 1: datacenter, configurable timeout ---
    try {
      const result = await this.scrapeSingleUrl(url, index, undefined, datacenterTimeoutMs);

      if (result) {
        // Check for soft blocks (200 + bot page content)
        const blockCheck = isBlockedResponse(
          result.metadata?.statusCode,
          result.rawHtml,
          this.options.blockDetection
        );

        if (!blockCheck.blocked) {
          return { result };
        }

        this.logger.warn(
          `[scraper] Block detected for ${url} (${blockCheck.reason}), escalating to residential`
        );
        // Fall through to residential attempt
      }
    } catch (error: any) {
      // Non-retryable errors — don't escalate
      if (error instanceof ReaderError && error.retryable === false) {
        this.logger.error(`Non-retryable error for ${url}: ${error.name} - ${error.message}`);
        return { result: null, error: error.message };
      }

      this.logger.warn(
        `[scraper] Datacenter attempt failed for ${url}: ${error.message}, escalating to residential`
      );
      // Fall through to residential attempt
    }

    // --- Attempt 2: residential, remaining time ---
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return {
        result: null,
        error: `Scrape exceeded ${hardDeadlineMs / 1000}s hard cap for ${url}`,
      };
    }

    try {
      const result = await this.scrapeSingleUrl(url, index, "residential", remaining);

      if (result) {
        return { result };
      }

      return { result: null, error: `No content returned for ${url} on residential proxy` };
    } catch (error: any) {
      this.logger.error(`[scraper] Residential attempt failed for ${url}: ${error.message}`);
      return { result: null, error: error.message };
    }
  }

  /**
   * Scrape a single URL using the engine orchestrator.
   *
   * @param proxyOverride - Forces this proxy tier instead of the configured one.
   * @param timeoutMs - Overrides the configured timeout.
   */
  private async scrapeSingleUrl(
    url: string,
    index: number,
    proxyOverride?: ProxyTier,
    timeoutMs?: number
  ): Promise<WebsiteScrapeResult | null> {
    const startTime = Date.now();

    // Apply URL rewrite rules (caller-provided, e.g. Google Docs → export)
    const rewrite = rewriteUrl(url, this.options.urlRewriters);
    const scrapeTargetUrl = rewrite.url;
    if (rewrite.rewritten && this.options.verbose) {
      this.logger.info(`[scraper] Rewriting ${url} -> ${scrapeTargetUrl} (${rewrite.reason})`);
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      throw new InvalidUrlError(url, "malformed URL");
    }

    // Check robots.txt
    const robotsRules = await this.getRobotsRules(url);
    if (!isUrlAllowed(url, robotsRules)) {
      throw new RobotsBlockedError(url);
    }

    try {
      // Apply domain-specific overrides (caller-provided profiles)
      const domainProfile = getDomainProfile(url, this.options.domainProfiles);
      let effectiveOptions = domainProfile
        ? applyDomainProfile(this.options, domainProfile)
        : { ...this.options };

      // Apply proxy escalation override
      if (proxyOverride) {
        effectiveOptions = { ...effectiveOptions, proxyTier: proxyOverride };
      }

      // Apply timeout override
      if (timeoutMs) {
        effectiveOptions = { ...effectiveOptions, timeoutMs };
      }

      if (domainProfile && this.options.verbose) {
        this.logger.info(
          `[scraper] Applied domain profile for ${url}: ${JSON.stringify(domainProfile)}`
        );
      }

      // --- Per-attempt proxy resolution ---
      const resolveProxyFn = this.options.resolveProxy;
      if (!this.options.proxy && resolveProxyFn) {
        const resolved = resolveProxyFn(effectiveOptions.proxyTier);
        if (resolved) {
          effectiveOptions = { ...effectiveOptions, proxy: resolved };
        }
      }

      const currentProxyUrl = effectiveOptions.proxy?.url ?? null;

      // Domain-profile per-IP cap override
      if (domainProfile?.maxConcurrentPerProxy && currentProxyUrl && this.options.proxyGate) {
        (this.options.proxyGate as PerProxyGate).setOverride(
          currentProxyUrl,
          domainProfile.maxConcurrentPerProxy
        );
      }

      if (this.options.verbose) {
        this.logger.info(
          `[scraper] ${url} using tier=${effectiveOptions.proxyTier ?? "auto"} ` +
            `proxy=${redactProxyUrl(currentProxyUrl)}` +
            (domainProfile?.maxConcurrentPerProxy
              ? ` cap=${domainProfile.maxConcurrentPerProxy}`
              : "")
        );
      }

      // Create orchestrator
      const orchestrator = new EngineOrchestrator({
        logger: this.logger,
        verbose: effectiveOptions.verbose,
      });

      // --- Gated scrape ---
      const proxyGate = this.options.proxyGate as PerProxyGate | undefined;
      const healthTracker = this.options.healthTracker as ProxyHealthTracker | undefined;

      const runScrape = () =>
        orchestrator.scrape({
          url: scrapeTargetUrl,
          options: effectiveOptions,
          logger: this.logger,
        });

      let engineResult;
      try {
        engineResult = proxyGate
          ? await proxyGate.withSlot(currentProxyUrl, runScrape)
          : await runScrape();

        if (currentProxyUrl) healthTracker?.recordSuccess(currentProxyUrl);
      } catch (err: any) {
        const isProxyFault =
          err instanceof ProxyConnectionError ||
          (err.code && ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"].includes(err.code));
        if (currentProxyUrl && isProxyFault) {
          healthTracker?.recordFailure(currentProxyUrl);
        }
        throw err;
      }

      if (this.options.verbose) {
        this.logger.info(`[scraper] ${url} scraped with Hero in ${engineResult.duration}ms`);
      }

      // Detect JSON responses
      const jsonPayload = detectJsonPayload(engineResult.html, engineResult.statusCode);

      // Extract metadata from raw HTML before cleaning
      const websiteMetadata = extractMetadata(engineResult.html, engineResult.url);

      // Clean content
      const cleanedHtml = jsonPayload
        ? engineResult.html
        : cleanContent(engineResult.html, engineResult.url, {
            removeAds: this.options.removeAds,
            removeBase64Images: this.options.removeBase64Images,
            onlyMainContent: this.options.onlyMainContent,
            includeTags: this.options.includeTags,
            excludeTags: this.options.excludeTags,
            navigationSelectors: this.options.navigationSelectors,
          });

      const duration = Date.now() - startTime;

      // Convert to markdown
      const MAX_HTML_BYTES = parseInt(process.env.READER_MAX_HTML_SIZE || "2097152"); // 2MB
      let markdown: string | undefined;

      if (this.options.formats.includes("markdown")) {
        if (jsonPayload) {
          markdown = "```json\n" + jsonPayload + "\n```";
        } else {
          try {
            const htmlForConversion =
              cleanedHtml.length > MAX_HTML_BYTES
                ? (this.logger.warn(
                    `HTML too large for conversion (${cleanedHtml.length} bytes), truncating to ${MAX_HTML_BYTES}`
                  ),
                  cleanedHtml.slice(0, MAX_HTML_BYTES))
                : cleanedHtml;

            markdown = postprocessMarkdown(htmlToMarkdown(htmlForConversion));

            // onlyMainContent empty fallback
            if (
              this.options.onlyMainContent &&
              markdown.trim().length < 50 &&
              engineResult.html.length > 500
            ) {
              this.logger.warn(
                `[scraper] onlyMainContent produced ${markdown.trim().length} chars for ${url}, ` +
                  `retrying with full content`
              );
              const fullHtml = cleanContent(engineResult.html, engineResult.url, {
                removeAds: this.options.removeAds,
                removeBase64Images: this.options.removeBase64Images,
                onlyMainContent: false,
              });
              const fullForConversion =
                fullHtml.length > MAX_HTML_BYTES ? fullHtml.slice(0, MAX_HTML_BYTES) : fullHtml;
              markdown = postprocessMarkdown(htmlToMarkdown(fullForConversion));
            }
          } catch (conversionError: unknown) {
            const errMsg =
              conversionError instanceof Error ? conversionError.message : String(conversionError);
            this.logger.error(`Markdown conversion failed for ${url}: ${errMsg}`);
            markdown = cleanedHtml
              .replace(/<[^>]*>/g, " ")
              .replace(/\s+/g, " ")
              .trim();
          }
        }
      }

      const htmlOutput = this.options.formats.includes("html") ? cleanedHtml : undefined;

      // Report progress
      if (this.options.onProgress) {
        this.options.onProgress({
          completed: index + 1,
          total: this.options.urls.length,
          currentUrl: url,
        });
      }

      // Build proxy metadata from effective options (after escalation)
      let proxyMetadata: ProxyMetadata | undefined;
      if (effectiveOptions.proxy) {
        const proxy = effectiveOptions.proxy;
        const tier = effectiveOptions.proxyTier as ProxyTier | undefined;
        if (proxy.url) {
          try {
            const proxyUrl = new URL(proxy.url);
            proxyMetadata = {
              host: proxyUrl.hostname,
              port: parseInt(proxyUrl.port, 10) || 80,
              tier,
              country: proxy.country,
            };
          } catch {
            // Invalid URL, skip proxy metadata
          }
        } else if (proxy.host && proxy.port) {
          proxyMetadata = {
            host: proxy.host,
            port: proxy.port,
            tier,
            country: proxy.country,
          };
        }
      }

      const finalUrl = engineResult.url !== scrapeTargetUrl ? engineResult.url : undefined;

      const result: WebsiteScrapeResult = {
        rawHtml: engineResult.html,
        markdown,
        html: htmlOutput,
        metadata: {
          baseUrl: url,
          ...(finalUrl ? { finalUrl } : {}),
          statusCode: engineResult.statusCode,
          engine: engineResult.engine,
          totalPages: 1,
          scrapedAt: new Date().toISOString(),
          duration,
          website: websiteMetadata,
          proxy: proxyMetadata,
        },
      };

      return result;
    } catch (error: unknown) {
      // Report progress (failed) before re-throwing
      if (this.options.onProgress) {
        this.options.onProgress({
          completed: index + 1,
          total: this.options.urls.length,
          currentUrl: url,
        });
      }

      // Non-retryable typed errors — re-throw as-is
      if (
        error instanceof InvalidUrlError ||
        error instanceof RobotsBlockedError ||
        error instanceof DNSError
      ) {
        this.logger.error(`${error.name} for ${url}: ${error.message}`);
        throw error;
      }

      // ScrapeFailedError from orchestrator — re-throw for retry loop
      if (error instanceof ScrapeFailedError) {
        this.logger.error(`Failed to scrape ${url}: ${error.message}`);
        throw error;
      }

      // Unknown error — classify and re-throw
      const classified = wrapError(error, url);
      this.logger.error(
        `${classified.name} for ${url}: ${classified.message}` +
          (classified.retryable ? " (retryable)" : "")
      );
      throw classified;
    }
  }

  /**
   * Build final scrape result
   */
  private buildScrapeResult(
    results: Array<{ result: WebsiteScrapeResult | null; error?: string }>,
    startTime: number
  ): ScrapeResult {
    const successful = results
      .filter((r) => r.result !== null)
      .map((r) => r.result as WebsiteScrapeResult);

    const errors: Array<{ url: string; error: string }> = [];
    results.forEach((r, index) => {
      if (r.result === null && r.error) {
        errors.push({ url: this.options.urls[index], error: r.error });
      }
    });

    const batchMetadata: BatchMetadata = {
      totalUrls: this.options.urls.length,
      successfulUrls: successful.length,
      failedUrls: results.filter((r) => r.result === null).length,
      scrapedAt: new Date().toISOString(),
      totalDuration: Date.now() - startTime,
      errors,
    };

    return {
      data: successful,
      batchMetadata,
    };
  }
}

/**
 * Detect if an engine response body is a JSON payload rather than HTML.
 */
function detectJsonPayload(body: string, statusCode: number): string | null {
  if (statusCode < 200 || statusCode >= 300) return null;
  if (!body) return null;

  const trimmed = body.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 500_000) return null;

  const firstChar = trimmed[0];
  const lastChar = trimmed[trimmed.length - 1];
  const looksJson =
    (firstChar === "{" && lastChar === "}") || (firstChar === "[" && lastChar === "]");
  if (!looksJson) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

/**
 * Convenience function to scrape URLs
 */
export async function scrape(options: ScrapeOptions): Promise<ScrapeResult> {
  const scraper = new Scraper(options);
  return scraper.scrape();
}
