import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

describe("GET /health", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await app.db.$client.end({ timeout: 5 });
  });

  it("returns ok status with an ISO timestamp", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it("reports ready when Postgres and Redis respond", async () => {
    const response = await app.inject({ method: "GET", url: "/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready" });
  });
});
