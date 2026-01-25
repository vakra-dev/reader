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
