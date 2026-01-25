import Hero from "@ulixee/hero";
import { createHeroConfig } from "./hero-config";
import type {
  BrowserInstance,
  QueueItem,
  PoolConfig,
  PoolStats,
  HealthStatus,
  IBrowserPool,
} from "./types";
import type { ProxyConfig } from "../types";
import { createLogger } from "../utils/logger";

/**
 * Default pool configuration
 */
const DEFAULT_POOL_CONFIG: PoolConfig = {
  size: 2,
  retireAfterPageCount: 100,
  retireAfterAgeMs: 30 * 60 * 1000, // 30 minutes
  recycleCheckInterval: 60 * 1000, // 1 minute
  healthCheckInterval: 5 * 60 * 1000, // 5 minutes
  maxConsecutiveFailures: 3,
  maxQueueSize: 100,
  queueTimeout: 60 * 1000, // 1 minute
};

/**
 * Generate unique ID
 */
function generateId(): string {
  return `browser_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Browser Pool
 *
 * Manages a pool of Hero browser instances with:
 * - Auto-recycling based on age/request count
 * - Request queuing when pool is full
 * - Health monitoring
 *
 * @example
 * const pool = new BrowserPool({ size: 5 });
 * await pool.initialize();
 *
 * // Use withBrowser for automatic acquire/release
 * await pool.withBrowser(async (hero) => {
 *   await hero.goto('https://example.com');
 *   const title = await hero.document.title;
 *   return title;
 * });
 *
 * await pool.shutdown();
 */
export class BrowserPool implements IBrowserPool {
  private instances: BrowserInstance[] = [];
  private available: BrowserInstance[] = [];
  private inUse: Set<BrowserInstance> = new Set();
  private queue: QueueItem[] = [];
  private config: PoolConfig;
  private proxy?: ProxyConfig;
  private recycleTimer?: NodeJS.Timeout;
  private healthTimer?: NodeJS.Timeout;
  private totalRequests = 0;
  private totalRequestDuration = 0;
  private showChrome: boolean;
  private connectionToCore?: any;
  private userAgent?: string;
  private verbose: boolean;
  private logger = createLogger("pool");

  constructor(
    config: Partial<PoolConfig> = {},
    proxy?: ProxyConfig,
    showChrome: boolean = false,
    connectionToCore?: any,
    userAgent?: string,
    verbose: boolean = false
  ) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
    this.proxy = proxy;
    this.showChrome = showChrome;
    this.connectionToCore = connectionToCore;
    this.userAgent = userAgent;
    this.verbose = verbose;
  }

  /**
   * Initialize the pool by pre-launching browsers
   */
  async initialize(): Promise<void> {
    if (this.verbose) {
      this.logger.info(`Initializing pool with ${this.config.size} browsers...`);
    }

    // Pre-launch browsers
    const launchPromises: Promise<BrowserInstance>[] = [];
    for (let i = 0; i < this.config.size; i++) {
      launchPromises.push(this.createInstance());
    }

    this.instances = await Promise.all(launchPromises);
    this.available = [...this.instances];

    // Start background tasks
    this.startRecycling();
    this.startHealthChecks();

    if (this.verbose) {
      this.logger.info(`Pool ready: ${this.instances.length} browsers available`);
    }
  }

  /**
   * Shutdown the pool and close all browsers
   */
  async shutdown(): Promise<void> {
    if (this.verbose) {
      const stats = this.getStats();
      this.logger.info(
        `Shutting down pool: ${stats.totalRequests} total requests processed, ` +
          `${Math.round(stats.avgRequestDuration)}ms avg duration`
      );
    }

    // Stop background tasks
    if (this.recycleTimer) clearInterval(this.recycleTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);

    // Reject all queued requests
    for (const item of this.queue) {
      item.reject(new Error("Pool shutting down"));
    }
    this.queue = [];

    // Close all browsers
    const closePromises = this.instances.map((instance) => instance.hero.close().catch(() => {}));
    await Promise.all(closePromises);

    // Disconnect the connection to core to release event listeners
    if (this.connectionToCore) {
      try {
        await this.connectionToCore.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.connectionToCore = undefined;
    }

    // Clear instances
    this.instances = [];
    this.available = [];
    this.inUse.clear();
  }

  /**
   * Acquire a browser from the pool
   */
  async acquire(): Promise<Hero> {
    // Get available instance
    const instance = this.available.shift();
    if (!instance) {
      // No available instances, queue the request
      if (this.verbose) {
        this.logger.info(`No browsers available, queuing request (queue: ${this.queue.length + 1})`);
      }
      return this.queueRequest();
    }

    // Mark as busy
    instance.status = "busy";
    instance.lastUsed = Date.now();
    this.inUse.add(instance);

    if (this.verbose) {
      this.logger.info(
        `Acquired browser ${instance.id} (available: ${this.available.length}, busy: ${this.inUse.size})`
      );
    }

    return instance.hero;
  }

  /**
   * Release a browser back to the pool
   */
  release(hero: Hero): void {
    const instance = this.instances.find((i) => i.hero === hero);
    if (!instance) return;

    // Update stats
    instance.status = "idle";
    instance.requestCount++;
    this.inUse.delete(instance);

    if (this.verbose) {
      this.logger.info(
        `Released browser ${instance.id} (requests: ${instance.requestCount}, available: ${this.available.length + 1})`
      );
    }

    // Check if needs recycling
    if (this.shouldRecycle(instance)) {
      if (this.verbose) {
        this.logger.info(`Recycling browser ${instance.id} (age or request limit reached)`);
      }
      this.recycleInstance(instance).catch(() => {});
    } else {
      this.available.push(instance);
      this.processQueue();
    }
  }

  /**
   * Execute callback with auto-managed browser
   */
  async withBrowser<T>(callback: (hero: Hero) => Promise<T>): Promise<T> {
    const startTime = Date.now();
    const hero = await this.acquire();

    try {
      const result = await callback(hero);

      // Update request stats
      this.totalRequests++;
      this.totalRequestDuration += Date.now() - startTime;

      return result;
    } finally {
      this.release(hero);
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    const recycling = this.instances.filter((i) => i.status === "recycling").length;
    const unhealthy = this.instances.filter((i) => i.status === "unhealthy").length;

    return {
      total: this.instances.length,
      available: this.available.length,
      busy: this.inUse.size,
      recycling,
      unhealthy,
      queueLength: this.queue.length,
      totalRequests: this.totalRequests,
      avgRequestDuration:
        this.totalRequests > 0 ? this.totalRequestDuration / this.totalRequests : 0,
    };
  }

  /**
   * Run health check
   */
  async healthCheck(): Promise<HealthStatus> {
    const issues: string[] = [];
    const stats = this.getStats();

    // Check for unhealthy instances
    if (stats.unhealthy > 0) {
      issues.push(`${stats.unhealthy} unhealthy instances`);
    }

    // Check queue size
    if (stats.queueLength > this.config.maxQueueSize * 0.8) {
      issues.push(`Queue near capacity: ${stats.queueLength}/${this.config.maxQueueSize}`);
    }

    // Check if pool is saturated
    if (stats.available === 0 && stats.queueLength > 0) {
      issues.push("Pool saturated - all browsers busy with pending requests");
    }

    return {
      healthy: issues.length === 0,
      issues,
      stats,
    };
  }

  // =========================================================================
  // Private methods
  // =========================================================================

  /**
   * Create a new browser instance
   */
  private async createInstance(): Promise<BrowserInstance> {
    const heroConfig = createHeroConfig({
      proxy: this.proxy,
      showChrome: this.showChrome,
      connectionToCore: this.connectionToCore,
      userAgent: this.userAgent,
    });

    const hero = new Hero(heroConfig);

    return {
      hero,
      id: generateId(),
      createdAt: Date.now(),
      lastUsed: Date.now(),
      requestCount: 0,
      status: "idle",
    };
  }

  /**
   * Check if instance should be recycled
   */
  private shouldRecycle(instance: BrowserInstance): boolean {
    const age = Date.now() - instance.createdAt;
    return (
      instance.requestCount >= this.config.retireAfterPageCount ||
      age >= this.config.retireAfterAgeMs
    );
  }

  /**
   * Recycle an instance (close old, create new)
   */
  private async recycleInstance(instance: BrowserInstance): Promise<void> {
    instance.status = "recycling";

    try {
      // Close old instance
      await instance.hero.close().catch(() => {});

      // Create new instance
      const newInstance = await this.createInstance();

      // Replace in instances array
      const index = this.instances.indexOf(instance);
      if (index !== -1) {
        this.instances[index] = newInstance;
      }

      // Add to available pool
      this.available.push(newInstance);

      if (this.verbose) {
        this.logger.info(`Recycled browser: ${instance.id} → ${newInstance.id}`);
      }

      // Process queue
      this.processQueue();
    } catch (error) {
      // Failed to recycle, mark as unhealthy
      instance.status = "unhealthy";
      if (this.verbose) {
        this.logger.warn(`Failed to recycle browser ${instance.id}`);
      }
    }
  }

  /**
   * Queue a request when no browsers available
   */
  private queueRequest(): Promise<Hero> {
    return new Promise<Hero>((resolve, reject) => {
      // Check queue size
      if (this.queue.length >= this.config.maxQueueSize) {
        reject(new Error("Queue full"));
        return;
      }

      // Add to queue
      const item: QueueItem = {
        resolve,
        reject,
        queuedAt: Date.now(),
      };
      this.queue.push(item);

      // Set timeout
      setTimeout(() => {
        const index = this.queue.indexOf(item);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new Error("Queue timeout"));
        }
      }, this.config.queueTimeout);
    });
  }

  /**
   * Process queued requests
   */
  private processQueue(): void {
    while (this.queue.length > 0 && this.available.length > 0) {
      const item = this.queue.shift()!;

      // Check if still valid (not timed out)
      const age = Date.now() - item.queuedAt;
      if (age > this.config.queueTimeout) {
        item.reject(new Error("Queue timeout"));
        continue;
      }

      // Acquire and resolve
      this.acquire().then(item.resolve).catch(item.reject);
    }
  }

  /**
   * Start background recycling task
   */
  private startRecycling(): void {
    this.recycleTimer = setInterval(() => {
      for (const instance of this.instances) {
        if (instance.status === "idle" && this.shouldRecycle(instance)) {
          this.recycleInstance(instance).catch(() => {});
        }
      }
    }, this.config.recycleCheckInterval);
    // Allow process to exit even if timer is still running
    this.recycleTimer.unref();
  }

  /**
   * Start background health checks
   */
  private startHealthChecks(): void {
    this.healthTimer = setInterval(async () => {
      const health = await this.healthCheck();
      if (!health.healthy && health.issues.length > 0) {
        console.warn("[BrowserPool] Health issues:", health.issues);
      }
    }, this.config.healthCheckInterval);
    // Allow process to exit even if timer is still running
    this.healthTimer.unref();
  }
}

// Backward compatibility alias
export { BrowserPool as HeroBrowserPool };
