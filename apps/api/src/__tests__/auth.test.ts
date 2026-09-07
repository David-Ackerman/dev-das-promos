import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { SESSION_COOKIE_NAME } from "../plugins/auth.js";

function extractCookie(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error("expected a set-cookie header");
  return raw.split(";")[0] ?? raw;
}

describe("auth routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await app.db.$client.end({ timeout: 5 });
  });

  describe("POST /auth/login", () => {
    it("rejects a malformed body", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "not-an-email", password: "" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("rejects an unknown email", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "not-a-real-admin@example.com", password: "whatever123" },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "Invalid email or password" });
    });

    it("rejects the correct email with a wrong password", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: process.env.ADMIN_EMAIL, password: "definitely-wrong-password" },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "Invalid email or password" });
    });

    it("logs in with correct admin credentials and sets a signed session cookie", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.email).toBe(process.env.ADMIN_EMAIL);
      expect(body.id).toBeDefined();

      const setCookie = response.headers["set-cookie"];
      expect(setCookie).toBeDefined();
      const cookieHeader = Array.isArray(setCookie) ? setCookie.join(";") : setCookie;
      expect(cookieHeader).toContain(SESSION_COOKIE_NAME);
      expect(cookieHeader).toContain("HttpOnly");
    });
  });

  describe("GET /auth/me", () => {
    it("rejects a request with no session cookie", async () => {
      const response = await app.inject({ method: "GET", url: "/auth/me" });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "Not authenticated" });
    });

    it("rejects a garbage session cookie", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { cookie: `${SESSION_COOKIE_NAME}=not-a-valid-signed-value` },
      });
      expect(response.statusCode).toBe(401);
    });

    it("returns the current admin for a valid session cookie", async () => {
      const login = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
      });
      const cookie = extractCookie(login.headers["set-cookie"]);

      const response = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { cookie },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.email).toBe(process.env.ADMIN_EMAIL);
    });
  });

  describe("POST /auth/logout", () => {
    it("clears the session cookie and returns ok", async () => {
      const response = await app.inject({ method: "POST", url: "/auth/logout" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });

      const setCookie = response.headers["set-cookie"];
      const cookieHeader = Array.isArray(setCookie) ? setCookie.join(";") : setCookie;
      expect(cookieHeader).toContain(`${SESSION_COOKIE_NAME}=;`);
    });
  });
});
