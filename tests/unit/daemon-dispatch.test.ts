import { describe, it, expect, beforeEach, vi } from "vitest";
import { Readable } from "stream";
import http from "http";
import { DaemonServer } from "../../src/daemon/server";

/**
 * Unit tests for DaemonServer POST / request dispatch.
 *
 * These test the handleRequest method directly (via `as any`) with mock
 * IncomingMessage and ServerResponse objects, avoiding the need to start
 * a real server or browser pool.
 */

// ---- Helpers ----

/** Create a mock IncomingMessage from method, url, body string, and optional headers. */
function mockReq(
  method: string,
  url: string,
  body: string = "",
  headers: Record<string, string> = {},
): http.IncomingMessage {
  const readable = new Readable({
    read() {
      this.push(body);
      this.push(null);
    },
  });

  // Overlay the HTTP-specific properties onto the Readable stream.
  Object.assign(readable, {
    method,
    url,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });

  return readable as unknown as http.IncomingMessage;
}

/** Captured response data from a mock ServerResponse. */
interface CapturedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
}

/** Create a mock ServerResponse that captures writeHead/end calls. */
function mockRes(): { res: http.ServerResponse; captured: () => CapturedResponse } {
  let statusCode = 200;
  let responseHeaders: Record<string, string> = {};
  let bodyChunks: string[] = [];

  const fake = {
    writeHead(code: number, headers?: Record<string, string>) {
      statusCode = code;
      if (headers) responseHeaders = headers;
    },
    end(data?: string) {
      if (data) bodyChunks.push(data);
    },
  };

  return {
    res: fake as unknown as http.ServerResponse,
    captured: () => ({
      statusCode,
      headers: responseHeaders,
      body: (() => {
        const raw = bodyChunks.join("");
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      })(),
    }),
  };
}

// ---- Tests ----

describe("DaemonServer POST / dispatch", () => {
  let daemon: DaemonServer;
  let handleRequest: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;

  // Mock client with scrape, crawl, isReady
  const mockClient = {
    scrape: vi.fn(),
    crawl: vi.fn(),
    isReady: vi.fn(() => true),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    daemon = new DaemonServer({ port: 0 });
    // Inject mock client without starting the server
    (daemon as any).client = mockClient;
    // Set startTime so status uptime works
    (daemon as any).startTime = Date.now();
    // Bind handleRequest
    handleRequest = (daemon as any).handleRequest.bind(daemon);
  });

  // 1. action=scrape calls client.scrape and returns result
  it("dispatches action=scrape to client.scrape and returns 200", async () => {
    const scrapeResult = { data: [{ url: "https://example.com", markdown: "# Hello" }] };
    mockClient.scrape.mockResolvedValue(scrapeResult);

    const req = mockReq("POST", "/", JSON.stringify({
      action: "scrape",
      options: { urls: ["https://example.com"] },
    }));
    const { res, captured } = mockRes();

    await handleRequest(req, res);
    const out = captured();

    expect(out.statusCode).toBe(200);
    expect(out.body.success).toBe(true);
    expect(out.body.data).toEqual(scrapeResult);
    expect(mockClient.scrape).toHaveBeenCalledWith({ urls: ["https://example.com"] });
  });

  // 2. action=crawl calls client.crawl and returns result
  it("dispatches action=crawl to client.crawl and returns 200", async () => {
    const crawlResult = { urls: ["https://example.com", "https://example.com/about"] };
    mockClient.crawl.mockResolvedValue(crawlResult);

    const req = mockReq("POST", "/", JSON.stringify({
      action: "crawl",
      options: { url: "https://example.com", depth: 2 },
    }));
    const { res, captured } = mockRes();

    await handleRequest(req, res);
    const out = captured();

    expect(out.statusCode).toBe(200);
    expect(out.body.success).toBe(true);
    expect(out.body.data).toEqual(crawlResult);
    expect(mockClient.crawl).toHaveBeenCalledWith({ url: "https://example.com", depth: 2 });
  });

  // 3. action=status returns pool stats
  it("dispatches action=status and returns daemon status", async () => {
    const req = mockReq("POST", "/", JSON.stringify({ action: "status" }));
    const { res, captured } = mockRes();

    await handleRequest(req, res);
    const out = captured();

    expect(out.statusCode).toBe(200);
    expect(out.body.success).toBe(true);
    expect(out.body.data.running).toBe(true);
    expect(out.body.data.ready).toBe(true);
    expect(typeof out.body.data.uptime).toBe("number");
    expect(typeof out.body.data.pid).toBe("number");
    expect(typeof out.body.data.activeRequests).toBe("number");
  });

  // 4. action=unknown returns 400
  it("returns 400 for unknown action", async () => {
    const req = mockReq("POST", "/", JSON.stringify({ action: "bogus" }));
    const { res, captured } = mockRes();

    await handleRequest(req, res);
    const out = captured();

    expect(out.statusCode).toBe(400);
    expect(out.body.success).toBe(false);
    expect(out.body.error).toBe("Unknown action");
  });

  // 5. Invalid JSON returns 400
  it("returns 400 for invalid JSON body", async () => {
    const req = mockReq("POST", "/", "not-json{{{");
    const { res, captured } = mockRes();

    await handleRequest(req, res);
    const out = captured();

    expect(out.statusCode).toBe(400);
    expect(out.body.success).toBe(false);
    expect(out.body.error).toBe("Invalid JSON");
  });

  // 6. During shutdown returns 503
  it("returns 503 when server is shutting down", async () => {
    (daemon as any).shuttingDown = true;

    const req = mockReq("POST", "/", JSON.stringify({ action: "scrape", options: { urls: ["https://example.com"] } }));
    const { res, captured } = mockRes();

    await handleRequest(req, res);
    const out = captured();

    expect(out.statusCode).toBe(503);
    expect(out.body.success).toBe(false);
    expect(out.body.error).toBe("Server is shutting down");
  });

  // 7. Client is null returns 500
  it("returns 500 when client is not initialized (scrape)", async () => {
    (daemon as any).client = null;

    const req = mockReq("POST", "/", JSON.stringify({
      action: "scrape",
      options: { urls: ["https://example.com"] },
    }));
    const { res, captured } = mockRes();

    await handleRequest(req, res);
    const out = captured();

    expect(out.statusCode).toBe(500);
    expect(out.body.success).toBe(false);
    expect(out.body.error).toBe("Client not initialized");
  });

  it("returns 500 when client is not initialized (crawl)", async () => {
    (daemon as any).client = null;

    const req = mockReq("POST", "/", JSON.stringify({
      action: "crawl",
      options: { url: "https://example.com" },
    }));
    const { res, captured } = mockRes();

    await handleRequest(req, res);
    const out = captured();

    expect(out.statusCode).toBe(500);
    expect(out.body.success).toBe(false);
    expect(out.body.error).toBe("Client not initialized");
  });

  // 8. Scrape that throws returns 500 with error message
  it("returns 500 when client.scrape throws", async () => {
    mockClient.scrape.mockRejectedValue(new Error("Browser crashed"));

    const req = mockReq("POST", "/", JSON.stringify({
      action: "scrape",
      options: { urls: ["https://example.com"] },
    }));
    const { res, captured } = mockRes();

    await handleRequest(req, res);
    const out = captured();

    expect(out.statusCode).toBe(500);
    expect(out.body.success).toBe(false);
    expect(out.body.error).toBe("Browser crashed");
  });

  it("returns 500 when client.crawl throws", async () => {
    mockClient.crawl.mockRejectedValue(new Error("Timeout exceeded"));

    const req = mockReq("POST", "/", JSON.stringify({
      action: "crawl",
      options: { url: "https://example.com" },
    }));
    const { res, captured } = mockRes();

    await handleRequest(req, res);
    const out = captured();

    expect(out.statusCode).toBe(500);
    expect(out.body.success).toBe(false);
    expect(out.body.error).toBe("Timeout exceeded");
  });

  // 9. GET /health returns 200 (no auth needed)
  it("GET /health returns 200 without auth", async () => {
    // Re-create daemon with auth token to prove /health skips auth
    daemon = new DaemonServer({ port: 0, authToken: "secret" });
    (daemon as any).client = mockClient;
    handleRequest = (daemon as any).handleRequest.bind(daemon);

    const req = mockReq("GET", "/health");
    const { res, captured } = mockRes();

    await handleRequest(req, res);
    const out = captured();

    expect(out.statusCode).toBe(200);
    expect(out.body.success).toBe(true);
    expect(out.body.data.status).toBe("ok");
  });

  // 10. POST / without auth token returns 401
  it("returns 401 when auth is required but missing", async () => {
    daemon = new DaemonServer({ port: 0, authToken: "secret" });
    (daemon as any).client = mockClient;
    (daemon as any).startTime = Date.now();
    handleRequest = (daemon as any).handleRequest.bind(daemon);

    const req = mockReq("POST", "/", JSON.stringify({ action: "status" }));
    const { res, captured } = mockRes();

    await handleRequest(req, res);
    const out = captured();

    expect(out.statusCode).toBe(401);
    expect(out.body.success).toBe(false);
    expect(out.body.error).toBe("Unauthorized");
  });

  it("allows POST / with correct auth token", async () => {
    daemon = new DaemonServer({ port: 0, authToken: "secret" });
    (daemon as any).client = mockClient;
    (daemon as any).startTime = Date.now();
    handleRequest = (daemon as any).handleRequest.bind(daemon);

    const req = mockReq("POST", "/", JSON.stringify({ action: "status" }), {
      authorization: "Bearer secret",
    });
    const { res, captured } = mockRes();

    await handleRequest(req, res);
    const out = captured();

    expect(out.statusCode).toBe(200);
    expect(out.body.success).toBe(true);
    expect(out.body.data.running).toBe(true);
  });

  // Edge case: 404 for non-POST non-GET routes
  it("returns 404 for unsupported method/path", async () => {
    const req = mockReq("PUT", "/");
    const { res, captured } = mockRes();

    await handleRequest(req, res);
    const out = captured();

    expect(out.statusCode).toBe(404);
    expect(out.body.error).toBe("Not found");
  });

  // Edge case: activeRequests counter is decremented even on error
  it("decrements activeRequests after scrape error", async () => {
    mockClient.scrape.mockRejectedValue(new Error("fail"));
    expect((daemon as any).activeRequests).toBe(0);

    const req = mockReq("POST", "/", JSON.stringify({
      action: "scrape",
      options: { urls: ["https://example.com"] },
    }));
    const { res } = mockRes();

    await handleRequest(req, res);

    expect((daemon as any).activeRequests).toBe(0);
  });
});
