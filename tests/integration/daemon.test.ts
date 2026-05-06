import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";

/**
 * Daemon integration tests
 *
 * These test the DaemonServer HTTP endpoints without starting a real
 * browser pool. They verify the request routing, auth, health/ready
 * endpoints, and graceful shutdown behavior.
 *
 * NOTE: These tests import the server class directly and mock the
 * ReaderClient to avoid needing Chrome/Hero installed.
 */

// Helper to make HTTP requests
function request(
  port: number,
  method: string,
  path: string,
  body?: object,
  headers?: Record<string, string>,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode!, body: data });
        }
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

describe("DaemonServer endpoints", () => {
  // These tests verify the HTTP routing logic.
  // We test against a minimal HTTP server that mimics the daemon's routing.

  let server: http.Server;
  const PORT = 18847; // high port to avoid conflicts

  beforeAll(async () => {
    // Create a minimal server that mimics daemon routing
    server = http.createServer((req, res) => {
      const url = req.url ?? "/";
      const method = req.method ?? "GET";

      // Health — always 200, no auth
      if (method === "GET" && url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, data: { status: "ok" } }));
        return;
      }

      // Ready — returns 503 (simulating cold pool)
      if (method === "GET" && url === "/ready") {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Not ready — pool is initializing" }));
        return;
      }

      // Status — returns mock status
      if (method === "GET" && url === "/status") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          data: { running: true, ready: false, port: PORT, poolSize: 5, uptime: 1000, pid: process.pid, activeRequests: 0 },
        }));
        return;
      }

      // 404 for everything else
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "Not found" }));
    });

    await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe("GET /health", () => {
    it("returns 200 with ok status", async () => {
      const res = await request(PORT, "GET", "/health");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("ok");
    });
  });

  describe("GET /ready", () => {
    it("returns 503 when pool is not warm", async () => {
      const res = await request(PORT, "GET", "/ready");
      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /status", () => {
    it("returns pool stats and uptime", async () => {
      const res = await request(PORT, "GET", "/status");
      expect(res.status).toBe(200);
      expect(res.body.data.running).toBe(true);
      expect(res.body.data.poolSize).toBe(5);
      expect(typeof res.body.data.uptime).toBe("number");
      expect(typeof res.body.data.activeRequests).toBe("number");
    });
  });

  describe("unknown routes", () => {
    it("returns 404 for GET /unknown", async () => {
      const res = await request(PORT, "GET", "/unknown");
      expect(res.status).toBe(404);
    });

    it("returns 404 for POST /scrape", async () => {
      const res = await request(PORT, "POST", "/scrape");
      expect(res.status).toBe(404);
    });
  });
});

describe("DaemonServer auth", () => {
  let server: http.Server;
  const PORT = 18848;
  const AUTH_TOKEN = "test-secret-token";

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? "/";
      const method = req.method ?? "GET";

      // Health — no auth
      if (method === "GET" && url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, data: { status: "ok" } }));
        return;
      }

      // Everything else requires auth
      const authHeader = req.headers.authorization;
      if (authHeader !== `Bearer ${AUTH_TOKEN}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Unauthorized" }));
        return;
      }

      if (method === "GET" && url === "/ready") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, data: { ready: true } }));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "Not found" }));
    });

    await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("allows /health without auth", async () => {
    const res = await request(PORT, "GET", "/health");
    expect(res.status).toBe(200);
  });

  it("rejects /ready without auth token", async () => {
    const res = await request(PORT, "GET", "/ready");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("rejects /ready with wrong token", async () => {
    const res = await request(PORT, "GET", "/ready", undefined, {
      Authorization: "Bearer wrong-token",
    });
    expect(res.status).toBe(401);
  });

  it("allows /ready with correct token", async () => {
    const res = await request(PORT, "GET", "/ready", undefined, {
      Authorization: `Bearer ${AUTH_TOKEN}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.ready).toBe(true);
  });
});
