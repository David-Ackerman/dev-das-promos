import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";

describe("internal routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await app.db.$client.end({ timeout: 5 });
  });

  it("rejects requests missing the X-Internal-Token header", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/internal/ingestion/run",
      payload: { marketplace: "amazon_br" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Invalid or missing X-Internal-Token" });
  });

  it("rejects requests with an incorrect X-Internal-Token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/internal/ingestion/run",
      headers: { "x-internal-token": "definitely-the-wrong-token" },
      payload: { marketplace: "amazon_br" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("passes the auth gate and queues ingestion with the correct token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/internal/ingestion/run",
      headers: { "x-internal-token": process.env.INTERNAL_API_TOKEN! },
      payload: { marketplace: "amazon_br" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ queued: true, marketplace: "amazon_br" });
  });

  it("rejects an invalid body even with a correct token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/internal/ingestion/run",
      headers: { "x-internal-token": process.env.INTERNAL_API_TOKEN! },
      payload: { marketplace: "not-a-real-marketplace" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 404 when approving a deal id that does not exist", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/internal/deals/${UNKNOWN_ID}/approve`,
      headers: { "x-internal-token": process.env.INTERNAL_API_TOKEN! },
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns 404 when rejecting a deal id that does not exist", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/internal/deals/${UNKNOWN_ID}/reject`,
      headers: { "x-internal-token": process.env.INTERNAL_API_TOKEN! },
    });

    expect(response.statusCode).toBe(404);
  });

  it("still gates /internal/deals/:id/approve without a token, before touching the db", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/internal/deals/${UNKNOWN_ID}/approve`,
    });

    expect(response.statusCode).toBe(401);
  });
});
