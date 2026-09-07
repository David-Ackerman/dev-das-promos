import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPriceHistorySummary, getPriceSeries } from "../price-history.js";
import * as schema from "../schema/index.js";
import { categories, marketplaceProducts, offers, products } from "../schema/index.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/das_promos";

const client = postgres(databaseUrl);
const db = drizzle(client, { schema });

const testId = randomUUID();
const DAY_MS = 24 * 60 * 60 * 1000;

let categoryId: string;
let productId: string;
let marketplaceProductId: string;

/**
 * Known offer fixtures, spread across the 7d / 30d / 90d windows plus two
 * observations further back than 90 days (so they only affect the
 * historical minimum and sample count). All effectivePriceCents values are
 * distinct so getPriceSeries results can be identified unambiguously.
 */
const offerFixtures = [
  { label: "A", daysAgo: 1, priceCents: 9100, effectivePriceCents: 9000 },
  { label: "B", daysAgo: 3, priceCents: 9500, effectivePriceCents: 9500 },
  { label: "C", daysAgo: 5, priceCents: 9200, effectivePriceCents: 9200 },
  { label: "D", daysAgo: 20, priceCents: 8800, effectivePriceCents: 8800 },
  { label: "E", daysAgo: 25, priceCents: 8700, effectivePriceCents: 8700 },
  { label: "F", daysAgo: 45, priceCents: 8500, effectivePriceCents: 8500 },
  { label: "G", daysAgo: 60, priceCents: 8200, effectivePriceCents: 8200 },
  { label: "H", daysAgo: 100, priceCents: 7000, effectivePriceCents: 7000 },
  { label: "I", daysAgo: 120, priceCents: 7500, effectivePriceCents: 7500 },
] as const;

beforeAll(async () => {
  const [category] = await db
    .insert(categories)
    .values({ name: `Test PHS Category ${testId}`, slug: `test-phs-cat-${testId}` })
    .returning();
  if (!category) throw new Error("Failed to insert test category");
  categoryId = category.id;

  const [product] = await db
    .insert(products)
    .values({
      name: `Test PHS Product ${testId}`,
      slug: `test-phs-product-${testId}`,
      brand: "TestBrand",
      categoryId,
      metadata: {},
    })
    .returning();
  if (!product) throw new Error("Failed to insert test product");
  productId = product.id;

  const [marketplaceProduct] = await db
    .insert(marketplaceProducts)
    .values({
      productId,
      marketplace: "amazon_br",
      externalId: `test-phs-ext-${testId}`,
      url: `https://example.com/test-phs-${testId}`,
      metadata: {},
    })
    .returning();
  if (!marketplaceProduct) throw new Error("Failed to insert test marketplace product");
  marketplaceProductId = marketplaceProduct.id;

  const now = Date.now();
  for (const fixture of offerFixtures) {
    await db.insert(offers).values({
      marketplaceProductId,
      priceCents: fixture.priceCents,
      shippingPriceCents: 0,
      couponValueCents: 0,
      effectivePriceCents: fixture.effectivePriceCents,
      currency: "BRL",
      availability: "in_stock",
      capturedAt: new Date(now - fixture.daysAgo * DAY_MS),
    });
  }
});

afterAll(async () => {
  // offers and marketplace_products cascade-delete from products.
  if (productId) {
    await db.delete(products).where(eq(products.id, productId));
  }
  if (categoryId) {
    await db.delete(categories).where(eq(categories.id, categoryId));
  }
  await client.end();
});

describe("getPriceHistorySummary", () => {
  it("computes exact aggregates from the known offer fixtures", async () => {
    const summary = await getPriceHistorySummary(db, marketplaceProductId);

    expect(summary.marketplaceProductId).toBe(marketplaceProductId);
    expect(summary.sampleCount).toBe(9);
    // Most recent observation (1 day ago) is offer A.
    expect(summary.currentPriceCents).toBe(9100);
    expect(summary.currentEffectivePriceCents).toBe(9000);
    // avg(9000, 9500, 9200) = 9233.33... -> rounds to 9233
    expect(summary.avg7dCents).toBe(9233);
    // avg(9000, 9500, 9200, 8800, 8700) = 9040 exactly
    expect(summary.avg30dCents).toBe(9040);
    // avg(9000, 9500, 9200, 8800, 8700, 8500, 8200) = 8842.857... -> rounds to 8843
    expect(summary.avg90dCents).toBe(8843);
    expect(summary.min30dCents).toBe(8700);
    expect(summary.min90dCents).toBe(8200);
    // Historical min includes the >90-day-old offers (H = 7000).
    expect(summary.historicalMinCents).toBe(7000);
  });

  it("returns sampleCount 0 and undefined price fields when there are no offers", async () => {
    const summary = await getPriceHistorySummary(db, randomUUID());

    expect(summary.sampleCount).toBe(0);
    expect(summary.currentPriceCents).toBeUndefined();
    expect(summary.currentEffectivePriceCents).toBeUndefined();
    expect(summary.avg7dCents).toBeUndefined();
    expect(summary.avg30dCents).toBeUndefined();
    expect(summary.avg90dCents).toBeUndefined();
    expect(summary.min30dCents).toBeUndefined();
    expect(summary.min90dCents).toBeUndefined();
    expect(summary.historicalMinCents).toBeUndefined();
  });
});

describe("getPriceSeries", () => {
  it("returns only offers within the last 7 days, ascending by capturedAt", async () => {
    const series = await getPriceSeries(db, marketplaceProductId, 7);

    expect(series.map((p) => p.effectivePriceCents)).toEqual([9200, 9500, 9000]);
    for (let i = 1; i < series.length; i++) {
      expect(series[i]!.capturedAt.getTime()).toBeGreaterThanOrEqual(
        series[i - 1]!.capturedAt.getTime(),
      );
    }
  });

  it("returns only offers within the last 30 days, ascending by capturedAt", async () => {
    const series = await getPriceSeries(db, marketplaceProductId, 30);

    expect(series.map((p) => p.effectivePriceCents)).toEqual([8700, 8800, 9200, 9500, 9000]);
  });

  it("returns every offer when days is 'all', ascending by capturedAt", async () => {
    const series = await getPriceSeries(db, marketplaceProductId, "all");

    expect(series.map((p) => p.effectivePriceCents)).toEqual([
      7500, 7000, 8200, 8500, 8700, 8800, 9200, 9500, 9000,
    ]);
  });

  it("returns an empty array for a marketplaceProductId with no offers", async () => {
    const series = await getPriceSeries(db, randomUUID(), "all");

    expect(series).toEqual([]);
  });
});
