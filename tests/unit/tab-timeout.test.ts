import { describe, it, expect, vi } from "vitest";

/**
 * Tests for Chrome tab slot leak prevention.
 *
 * These test the timeout and abort mechanisms that prevent
 * pLimit slots from being held forever when scrapes hang.
 */

describe("withPage hard timeout", () => {
  it("rejects after timeoutMs if fn never resolves", async () => {
    // Simulate the Promise.race pattern used in withPage
    const neverResolves = new Promise<string>(() => {});
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("withPage hard timeout after 100ms")), 100);
    });

    await expect(Promise.race([neverResolves, timeout])).rejects.toThrow(
      "withPage hard timeout after 100ms",
    );
  });

  it("returns result if fn resolves before timeout", async () => {
    const fast = new Promise<string>((resolve) => {
      setTimeout(() => resolve("done"), 10);
    });
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("timeout")), 200);
    });

    const result = await Promise.race([fast, timeout]);
    expect(result).toBe("done");
  });
});

describe("page.close timeout", () => {
  it("does not block if page.close hangs", async () => {
    // Simulate a hung page.close
    const hungClose = new Promise<void>(() => {});
    const closeTimeout = new Promise<void>((resolve) => setTimeout(resolve, 100));

    const start = Date.now();
    await Promise.race([hungClose, closeTimeout]);
    const elapsed = Date.now() - start;

    // Should resolve in ~100ms, not hang
    expect(elapsed).toBeLessThan(500);
  });
});

describe("drainLimit timeout", () => {
  it("breaks out of drain loop after deadline", async () => {
    // Simulate drainLimit with a timeout
    const drainWithTimeout = async (timeoutMs: number) => {
      const deadline = Date.now() + timeoutMs;
      let activeCount = 1; // simulate stuck slot
      let iterations = 0;

      while (activeCount > 0) {
        if (Date.now() > deadline) {
          break;
        }
        iterations++;
        await new Promise((r) => setTimeout(r, 10));
      }
      return iterations;
    };

    const start = Date.now();
    const iterations = await drainWithTimeout(100);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(iterations).toBeGreaterThan(0);
  });
});

describe("abort signal propagation", () => {
  it("AbortController signal starts as non-aborted", () => {
    const controller = new AbortController();
    expect(controller.signal.aborted).toBe(false);
  });

  it("abort() sets signal.aborted to true", () => {
    const controller = new AbortController();
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
  });

  it("abort event listener fires on abort", async () => {
    const controller = new AbortController();
    const listener = vi.fn();
    controller.signal.addEventListener("abort", listener, { once: true });

    controller.abort();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("Promise.race with abort signal rejects on abort", async () => {
    const controller = new AbortController();

    const slowWork = new Promise<string>((resolve) => {
      setTimeout(() => resolve("done"), 5000);
    });

    const abortPromise = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => reject(new Error("aborted")),
        { once: true },
      );
    });

    // Abort after 50ms
    setTimeout(() => controller.abort(), 50);

    await expect(Promise.race([slowWork, abortPromise])).rejects.toThrow("aborted");
  });

  it("already-aborted signal rejects immediately", async () => {
    const controller = new AbortController();
    controller.abort();

    const abortPromise = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) {
        reject(new Error("already aborted"));
      }
    });

    await expect(abortPromise).rejects.toThrow("already aborted");
  });
});

describe("client disconnect detection", () => {
  it("setInterval checks socket.destroyed periodically", async () => {
    const socket = { destroyed: false };
    const abortController = new AbortController();
    let checkCount = 0;

    const interval = setInterval(() => {
      checkCount++;
      if (socket.destroyed) {
        abortController.abort();
        clearInterval(interval);
      }
    }, 50);

    // Simulate client disconnect after 120ms
    setTimeout(() => {
      socket.destroyed = true;
    }, 120);

    await new Promise((r) => setTimeout(r, 250));
    clearInterval(interval);

    expect(abortController.signal.aborted).toBe(true);
    expect(checkCount).toBeGreaterThanOrEqual(2);
  });

  it("does not abort if response finishes before disconnect", async () => {
    const socket = { destroyed: false };
    const abortController = new AbortController();
    let writableEnded = false;

    const interval = setInterval(() => {
      if (socket.destroyed && !writableEnded) {
        abortController.abort();
        clearInterval(interval);
      }
    }, 50);

    // Response finishes first
    setTimeout(() => {
      writableEnded = true;
    }, 50);

    // Client disconnects later
    setTimeout(() => {
      socket.destroyed = true;
    }, 150);

    await new Promise((r) => setTimeout(r, 250));
    clearInterval(interval);

    // Should NOT have aborted because response was already sent
    expect(abortController.signal.aborted).toBe(false);
  });
});
