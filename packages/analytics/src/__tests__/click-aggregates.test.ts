import { randomUUID } from "node:crypto";
import {
  categories,
  clickEvents,
  createDatabase,
  dealCandidates,
  marketplaceProducts,
  offers,
  products,
  redirects,
} from "@dev-das-promos/database";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getClickAggregates } from "../click-aggregates.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/das_promos";

const db = createDatabase(databaseUrl);

const testId = randomUUID();
let categoryId: string;
let productId: string;
let dealCandidateId: string;

beforeAll(async () => {
  const [category] = await db
    .insert(categories)
    .values({ name: `Test Click Category ${testId}`, slug: `test-click-cat-${testId}` })
    .returning();
  if (!category) throw new Error("Failed to insert test category");
  categoryId = category.id;

  const [product] = await db
    .insert(products)
    .values({
      name: `Test Click Product ${testId}`,
      slug: `test-click-product-${testId}`,
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
      externalId: `test-click-ext-${testId}`,
      url: `https://example.com/test-click-${testId}`,
      metadata: {},
    })
    .returning();
  if (!marketplaceProduct) throw new Error("Failed to insert test marketplace product");

  const [offer] = await db
    .insert(offers)
    .values({
      marketplaceProductId: marketplaceProduct.id,
      priceCents: 10_000,
      shippingPriceCents: 0,
      couponValueCents: 0,
      effectivePriceCents: 10_000,
      currency: "BRL",
      availability: "in_stock",
    })
    .returning();
  if (!offer) throw new Error("Failed to insert test offer");

  const [deal] = await db
    .insert(dealCandidates)
    .values({
      offerId: offer.id,
      slug: `test-click-deal-${testId}`,
      dealScore: 90,
      realDiscountPercentage: 20,
      historicalPriceScore: 80,
      discountScore: 80,
      commissionScore: 80,
      sellerScore: 80,
      popularityScore: 80,
      conversionScore: 80,
      freshnessScore: 80,
      confidenceScore: 80,
    })
    .returning();
  if (!deal) throw new Error("Failed to insert test deal candidate");
  dealCandidateId = deal.id;

  // Two redirects/click events with a real channel, one with no channel
  // at all (the exact case that triggered the enum-coalesce bug).
  const channels = ["telegram", "telegram", "x", null] as const;
  for (const [i, channel] of channels.entries()) {
    const [redirect] = await db
      .insert(redirects)
      .values({
        code: `test-click-code-${testId}-${i}`,
        dealCandidateId,
        destinationUrl: "https://example.com/dest",
        channel: channel ?? undefined,
      })
      .returning();
    if (!redirect) throw new Error("Failed to insert test redirect");

    await db.insert(clickEvents).values({
      redirectId: redirect.id,
      dealCandidateId,
      channel: channel ?? undefined,
    });
  }
});

afterAll(async () => {
  // click_events and redirects cascade-delete from deal_candidates;
  // deal_candidates cascade-deletes from products via offers/marketplace_products.
  if (productId) await db.delete(products).where(eq(products.id, productId));
  if (categoryId) await db.delete(categories).where(eq(categories.id, categoryId));
  await db.$client.end();
});

describe("getClickAggregates channel dimension", () => {
  it("buckets a null channel as 'unknown' instead of erroring", async () => {
    const rows = await getClickAggregates(db, "channel", { dealCandidateId });

    const byKey = new Map(rows.map((r) => [r.key, r.clicks]));
    expect(byKey.get("telegram")).toBe(2);
    expect(byKey.get("x")).toBe(1);
    expect(byKey.get("unknown")).toBe(1);
  });
});
