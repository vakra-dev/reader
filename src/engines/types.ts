/**
 * Engine types for multi-engine scraping architecture
 *
 * Engine stack (in order of preference):
 * 1. http - Native fetch, fastest, no browser
 * 2. tlsclient - TLS fingerprinting via got-scraping
 * 3. hero - Full browser with JavaScript execution
 */

import type { ScrapeOptions } from "../types.js";
import type { Logger } from "../utils/logger.js";

/**
 * Available engine names
 */
export type EngineName = "http" | "tlsclient" | "hero";

/**
 * Result returned by an engine after scraping
 */
export interface EngineResult {
  /** Raw HTML content */
  html: string;
  /** Final URL after redirects */
  url: string;
  /** HTTP status code */
  statusCode: number;
  /** Content-Type header */
  contentType?: string;
  /** Response headers */
  headers?: Record<string, string>;

  /** Engine that produced this result */
  engine: EngineName;
  /** Time taken in milliseconds */
  duration: number;
}

/**
 * Metadata passed to engine scrape method
 */
export interface EngineMeta {
  /** URL to scrape */
  url: string;
  /** Scrape options */
  options: ScrapeOptions;
  /** Logger instance */
  logger?: Logger;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Engine configuration
 */
export interface EngineConfig {
  /** Engine name */
  name: EngineName;
  /** Timeout before starting next engine (ms) */
  timeout: number;
  /** Absolute max time before killing (ms) */
  maxTimeout: number;
  /** Quality score - higher means preferred (for sorting) */
  quality: number;
  /** Engine capabilities */
  features: EngineFeatures;
}

/**
 * Engine feature flags
 */
export interface EngineFeatures {
  /** Can execute JavaScript */
  javascript: boolean;
  /** Can handle Cloudflare challenges */
  cloudflare: boolean;
  /** Matches browser TLS fingerprint */
  tlsFingerprint: boolean;
  /** Supports waitFor selector */
  waitFor: boolean;
  /** Can take screenshots */
  screenshots: boolean;
}

/**
 * Engine interface - all engines must implement this
 */
export interface Engine {
  /** Engine configuration */
  readonly config: EngineConfig;

  /**
   * Scrape a URL
   * @param meta - Scrape metadata (url, options, logger, abortSignal)
   * @returns Engine result with HTML and metadata
   * @throws EngineError on failure
   */
  scrape(meta: EngineMeta): Promise<EngineResult>;

  /**
   * Check if engine is available and configured
   * @returns true if engine can be used
   */
  isAvailable(): boolean;
}

/**
 * Default engine configurations
 */
export const ENGINE_CONFIGS: Record<EngineName, EngineConfig> = {
  http: {
    name: "http",
    timeout: 3000,
    maxTimeout: 10000,
    quality: 100,
    features: {
      javascript: false,
      cloudflare: false,
      tlsFingerprint: false,
      waitFor: false,
      screenshots: false,
    },
  },
  tlsclient: {
    name: "tlsclient",
    timeout: 5000,
    maxTimeout: 15000,
    quality: 80,
    features: {
      javascript: false,
      cloudflare: false,
      tlsFingerprint: true,
      waitFor: false,
      screenshots: false,
    },
  },
  hero: {
    name: "hero",
    timeout: 30000,
    maxTimeout: 60000,
    quality: 50,
    features: {
      javascript: true,
      cloudflare: true,
      tlsFingerprint: true,
      waitFor: true,
      screenshots: true,
    },
  },
};

/**
 * Default engine order (by quality, highest first)
 */
export const DEFAULT_ENGINE_ORDER: EngineName[] = ["http", "tlsclient", "hero"];
