import pLimit from "p-limit";

/**
 * Simple rate limit function
 */
export async function rateLimit(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rate limiter using p-limit to control concurrent requests
 */
export class RateLimiter {
  private limit: ReturnType<typeof pLimit>;

  constructor(requestsPerSecond: number) {
    // Convert requests per second to concurrency limit
    // For rate limiting, we use pLimit with a delay between requests
    this.limit = pLimit(1);
    this.requestsPerSecond = requestsPerSecond;
  }

  private requestsPerSecond: number;
  private lastRequestTime = 0;

  /**
   * Execute a function with rate limiting
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return this.limit(async () => {
      await this.waitForNextSlot();
      return fn();
    });
  }

  /**
   * Wait for the next available time slot based on rate limit
   */
  private async waitForNextSlot(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minInterval = 1000 / this.requestsPerSecond;

    if (timeSinceLastRequest < minInterval) {
      const delay = minInterval - timeSinceLastRequest;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Execute multiple functions concurrently with rate limiting
   */
  async executeAll<T>(functions: Array<() => Promise<T>>): Promise<T[]> {
    return Promise.all(functions.map((fn) => this.execute(fn)));
  }
}
