/**
 * Engine types for the scraping engine.
 *
 * Reader uses a single engine: Hero (Ulixee), a full browser with
 * JavaScript execution, TLS fingerprinting, and Cloudflare bypass.
 */

import type { ScrapeOptions } from "../types.js";
import type { Logger } from "../utils/logger.js";

/**
 * Engine name — Hero is the only engine.
 */
export type EngineName = "hero";

/**
 * Result returned by the engine after scraping
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
  /** Default timeout (ms) */
  timeout: number;
  /** Absolute max time before killing (ms) */
  maxTimeout: number;
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
 * Engine interface
 */
export interface Engine {
  /** Engine configuration */
  readonly config: EngineConfig;

  /**
   * Scrape a URL
   */
  scrape(meta: EngineMeta): Promise<EngineResult>;

  /**
   * Check if engine is available and configured
   */
  isAvailable(): boolean;
}

/**
 * Hero engine configuration
 */
export const ENGINE_CONFIG: EngineConfig = {
  name: "hero",
  timeout: 10000,
  maxTimeout: 30000,
  features: {
    javascript: true,
    cloudflare: true,
    tlsFingerprint: true,
    waitFor: true,
    screenshots: true,
  },
};
