import type Hero from "@ulixee/hero";

/**
 * Browser instance in the pool
 */
export interface BrowserInstance {
  /** Hero instance */
  hero: Hero;

  /** Unique identifier */
  id: string;

  /** When the instance was created */
  createdAt: number;

  /** When the instance was last used */
  lastUsed: number;

  /** Number of requests handled */
  requestCount: number;

  /** Current status */
  status: "idle" | "busy" | "recycling" | "unhealthy";
}

/**
 * Queue item for pending requests
 */
export interface QueueItem {
  /** Promise resolve function */
  resolve: (hero: Hero) => void;

  /** Promise reject function */
  reject: (error: Error) => void;

  /** When the request was queued */
  queuedAt: number;
}

/**
 * Pool configuration
 */
export interface PoolConfig {
  /** Pool size (number of browser instances) */
  size: number;

  /** Retire browser after this many page loads */
  retireAfterPageCount: number;

  /** Retire browser after this age in milliseconds */
  retireAfterAgeMs: number;

  /** How often to check for recycling (ms) */
  recycleCheckInterval: number;

  /** How often to run health checks (ms) */
  healthCheckInterval: number;

  /** Max consecutive failures before marking unhealthy */
  maxConsecutiveFailures: number;

  /** Maximum queue size */
  maxQueueSize: number;

  /** Queue timeout in milliseconds */
  queueTimeout: number;
}

/**
 * Pool statistics
 */
export interface PoolStats {
  /** Total instances */
  total: number;

  /** Available instances */
  available: number;

  /** Busy instances */
  busy: number;

  /** Recycling instances */
  recycling: number;

  /** Unhealthy instances */
  unhealthy: number;

  /** Queue length */
  queueLength: number;

  /** Total requests handled */
  totalRequests: number;

  /** Average request duration */
  avgRequestDuration: number;
}

/**
 * Health status
 */
export interface HealthStatus {
  /** Overall health */
  healthy: boolean;

  /** Issues found */
  issues: string[];

  /** Stats snapshot */
  stats: PoolStats;
}

// =============================================================================
// Session types
// =============================================================================

/**
 * Options for creating a browser session
 */
export interface SessionCreateOptions {
  /** Viewport width (default: 1920) */
  viewportWidth?: number;
  /** Viewport height (default: 1080) */
  viewportHeight?: number;
}

/**
 * Navigation result
 */
export interface NavigationResult {
  url: string;
  title: string;
}

/**
 * Information about a DOM element
 */
export interface ElementInfo {
  /** Element tag name */
  tag: string;
  /** ARIA role or inferred role */
  role: string;
  /** Visible text content */
  text: string;
  /** Whether the element is visible */
  visible: boolean;
  /** Element attributes */
  attributes: Record<string, string>;
  /** Assigned @e ref (if snapshot was taken) */
  ref?: string;
}

/**
 * Console message captured during session
 */
export interface ConsoleEntry {
  /** Console level */
  level: "log" | "warn" | "error" | "info" | "debug";
  /** Message text */
  text: string;
  /** Source URL */
  url: string;
  /** Timestamp */
  timestamp: Date;
}

/**
 * Network request captured during session
 */
export interface NetworkEntry {
  /** Request URL */
  url: string;
  /** HTTP method */
  method: string;
  /** Response status code */
  status: number;
  /** Resource type */
  type: string;
  /** Duration in milliseconds */
  duration: number;
  /** Timestamp */
  timestamp: Date;
}

/**
 * Dialog event captured during session
 */
export interface DialogEntry {
  /** Dialog type */
  type: "alert" | "confirm" | "prompt" | "beforeunload";
  /** Dialog message */
  message: string;
  /** Timestamp */
  timestamp: Date;
}

/**
 * Cookie entry
 */
export interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  expires?: string;
}

/**
 * Options for taking a snapshot
 */
export interface SnapshotOptions {
  /** Only show interactive elements */
  interactive?: boolean;
  /** Return diff against previous snapshot */
  diff?: boolean;
  /** Scope to CSS selector */
  selector?: string;
}

/**
 * Options for taking a screenshot
 */
export interface ScreenshotOptions {
  /** Save to file path */
  path?: string;
  /** Overlay @e ref labels on interactive elements */
  annotate?: boolean;
  /** Image format */
  format?: "png" | "jpeg";
  /** Full page screenshot */
  fullPage?: boolean;
}

/**
 * Stored element reference for the @e ref system
 */
export interface ElementRef {
  /** The @e ref identifier (e.g., "@e1") */
  ref: string;
  /** CSS selector to find the element */
  selector: string;
  /** XPath as fallback */
  xpath: string;
  /** Element tag */
  tag: string;
  /** Element role */
  role: string;
  /** Visible text */
  text: string;
  /** Bounding box for annotations */
  boundingBox?: { x: number; y: number; width: number; height: number };
}

/**
 * Browser pool interface
 */
export interface IBrowserPool {
  /** Initialize the pool */
  initialize(): Promise<void>;

  /** Shutdown the pool */
  shutdown(): Promise<void>;

  /** Acquire a browser instance */
  acquire(): Promise<Hero>;

  /** Release a browser instance back to the pool */
  release(hero: Hero): void;

  /** Execute callback with auto-managed browser */
  withBrowser<T>(callback: (hero: Hero) => Promise<T>): Promise<T>;

  /** Get pool statistics */
  getStats(): PoolStats;

  /** Run health check */
  healthCheck?(): Promise<HealthStatus>;
}
