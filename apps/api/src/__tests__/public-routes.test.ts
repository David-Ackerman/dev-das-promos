import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

describe("public routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await app.db.$client.end({ timeout: 5 });
  });

  describe("GET /public/categories", () => {
    it("returns a list of categories", async () => {
      const response = await app.inject({ method: "GET", url: "/public/categories" });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body.categories)).toBe(true);
      expect(body.categories.length).toBeGreaterThan(0);
      const [category] = body.categories;
      expect(category).toHaveProperty("slug");
      expect(category).toHaveProperty("name");
    });
  });

  describe("GET /public/categories/:slug", () => {
    it("returns 404 for an unknown category slug", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/public/categories/does-not-exist-xyz",
      });
      expect(response.statusCode).toBe(404);
    });

    it("returns the category, its children, and a deals array for a known slug", async () => {
      const response = await app.inject({ method: "GET", url: "/public/categories/gaming" });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.category.slug).toBe("gaming");
      expect(Array.isArray(body.children)).toBe(true);
      expect(Array.isArray(body.deals)).toBe(true);
    });
  });

  describe("GET /public/products/:slug", () => {
    it("returns 404 for an unknown product slug", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/public/products/does-not-exist-xyz",
      });
      expect(response.statusCode).toBe(404);
    });

    it("returns the product with a listings array for a known slug", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/public/products/mouse-gamer-rgb-16000-dpi",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.slug).toBe("mouse-gamer-rgb-16000-dpi");
      expect(Array.isArray(body.listings)).toBe(true);
    });
  });

  describe("GET /public/deals", () => {
    it("returns a deals array", async () => {
      const response = await app.inject({ method: "GET", url: "/public/deals" });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body.deals)).toBe(true);
    });

    it("rejects an invalid pageSize", async () => {
      const response = await app.inject({ method: "GET", url: "/public/deals?pageSize=9999" });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /public/deals/:slug", () => {
    it("returns 404 for an unknown deal slug", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/public/deals/does-not-exist-xyz",
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /public/deals/:slug/price-history", () => {
    it("returns 404 for an unknown deal slug", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/public/deals/does-not-exist-xyz/price-history",
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
