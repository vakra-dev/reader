/**
 * AWS Lambda Handler for Reader
 *
 * NOTE: Running a full browser in Lambda requires special configuration:
 * - Use Lambda container images (not zip packages)
 * - Include Chrome/Chromium in the container
 * - Configure sufficient memory (2GB+)
 * - Set longer timeout (30-60 seconds)
 *
 * Consider using AWS ECS/Fargate for production browser workloads.
 */

import { ReaderClient } from "@vakra-dev/reader";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

interface ScrapeRequest {
  urls: string[];
  formats?: string[];
}

// Reuse client across warm Lambda invocations
let reader: ReaderClient | null = null;

async function getReader(): Promise<ReaderClient> {
  if (!reader) {
    reader = new ReaderClient();
    await reader.start();
  }
  return reader;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // CORS headers
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // Handle preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    // Parse request body
    const body: ScrapeRequest = JSON.parse(event.body || "{}");

    if (!body.urls || !Array.isArray(body.urls) || body.urls.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: "urls is required and must be a non-empty array",
        }),
      };
    }

    // Limit URLs per request
    if (body.urls.length > 5) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: "Maximum 5 URLs per request",
        }),
      };
    }

    // Get or initialize reader client
    const client = await getReader();

    // Scrape URLs
    const result = await client.scrape({
      urls: body.urls,
      formats: (body.formats as any) || ["markdown"],
      batchConcurrency: 1, // Sequential in Lambda
      timeoutMs: 25000, // Leave buffer for Lambda timeout
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: result.data,
        batchMetadata: result.batchMetadata,
      }),
    };
  } catch (error: any) {
    console.error("Lambda error:", error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || "Internal server error",
      }),
    };
  }
}
