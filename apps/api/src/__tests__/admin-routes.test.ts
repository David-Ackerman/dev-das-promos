import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";

function extractCookie(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error("expected a set-cookie header");
  return raw.split(";")[0] ?? raw;
}

describe("admin routes (/admin/deals)", () => {
  let app: FastifyInstance;
  let sessionCookie: string;

  beforeAll(async () => {
    app = await buildApp();

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
    });
    if (login.statusCode !== 200) {
      throw new Error(`expected admin login to succeed, got ${login.statusCode}: ${login.body}`);
    }
    sessionCookie = extractCookie(login.headers["set-cookie"]);
  });

  afterAll(async () => {
    await app.close();
    await app.db.$client.end({ timeout: 5 });
  });

  describe("GET /admin/deals", () => {
    it("rejects requests without a session cookie", async () => {
      const response = await app.inject({ method: "GET", url: "/admin/deals" });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "Not authenticated" });
    });

    it("returns a paginated deal list for an authenticated admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/deals",
        headers: { cookie: sessionCookie },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body.deals)).toBe(true);
      expect(typeof body.total).toBe("number");
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(25);
    });

    it("filters by status when given a valid status query param", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/deals?status=rejected",
        headers: { cookie: sessionCookie },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body.deals)).toBe(true);
      for (const deal of body.deals) {
        expect(deal.status).toBe("rejected");
      }
    });

    it("rejects an invalid status query param", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/deals?status=not-a-real-status",
        headers: { cookie: sessionCookie },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /admin/deals/:id", () => {
    it("rejects requests without a session cookie", async () => {
      const response = await app.inject({ method: "GET", url: `/admin/deals/${UNKNOWN_ID}` });
      expect(response.statusCode).toBe(401);
    });

    it("returns 404 for a deal id that does not exist", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/deals/${UNKNOWN_ID}`,
        headers: { cookie: sessionCookie },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("POST /admin/deals/:id/approve", () => {
    it("rejects requests without a session cookie", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/deals/${UNKNOWN_ID}/approve`,
      });
      expect(response.statusCode).toBe(401);
    });

    it("returns 404 for a deal id that does not exist", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/deals/${UNKNOWN_ID}/approve`,
        headers: { cookie: sessionCookie },
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
