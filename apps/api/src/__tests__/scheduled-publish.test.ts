import { randomUUID } from "node:crypto";
import {
  type Database,
  categories,
  createDatabase,
  dealCandidates,
  marketplaceProducts,
  offers,
  products,
} from "@dev-das-promos/database";
import {
  type QueueBundle,
  type Redis,
  closeQueues,
  createQueues,
  createRedisConnection,
} from "@dev-das-promos/queue";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publishReadyDeals } from "../services/scheduled-publish.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/das_promos";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const testId = randomUUID();
let db: Database;
let connection: Redis;
let queues: QueueBundle;
let categoryId: string;
let productId: string;
let autoApprovedHighId: string;
let autoApprovedLowId: string;
let approvedId: string;
let pendingId: string;
let publishedId: string;

async function insertDeal(
  status: "auto_approved" | "approved" | "pending" | "rejected" | "published",
  score: number,
  suffix: string,
): Promise<string> {
  const [marketplaceProduct] = await db
    .insert(marketplaceProducts)
    .values({
      productId,
      marketplace: "shopee_br",
      externalId: `test-sched-ext-${testId}-${suffix}`,
      url: `https://example.com/test-sched-${testId}-${suffix}`,
      metadata: {},
    })
    .returning();
  if (!marketplaceProduct) throw new Error("Failed to insert marketplace product");

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
  if (!offer) throw new Error("Failed to insert offer");

  const [deal] = await db
    .insert(dealCandidates)
    .values({
      offerId: offer.id,
      slug: `test-sched-deal-${testId}-${suffix}`,
      dealScore: score,
      realDiscountPercentage: 20,
      historicalPriceScore: 80,
      discountScore: 80,
      commissionScore: 80,
      sellerScore: 80,
      popularityScore: 80,
      conversionScore: 80,
      freshnessScore: 80,
      confidenceScore: 80,
      status,
    })
    .returning();
  if (!deal) throw new Error("Failed to insert deal candidate");
  return deal.id;
}

beforeAll(async () => {
  db = createDatabase(databaseUrl);
  connection = createRedisConnection(redisUrl);
  queues = createQueues(connection);

  const [category] = await db
    .insert(categories)
    .values({ name: `Test Sched Category ${testId}`, slug: `test-sched-cat-${testId}` })
    .returning();
  if (!category) throw new Error("Failed to insert category");
  categoryId = category.id;

  const [product] = await db
    .insert(products)
    .values({
      name: `Test Sched Product ${testId}`,
      slug: `test-sched-product-${testId}`,
      categoryId,
      metadata: {},
    })
    .returning();
  if (!product) throw new Error("Failed to insert product");
  productId = product.id;

  autoApprovedHighId = await insertDeal("auto_approved", 95, "auto-high");
  autoApprovedLowId = await insertDeal("auto_approved", 60, "auto-low");
  approvedId = await insertDeal("approved", 80, "approved");
  pendingId = await insertDeal("pending", 99, "pending");
  publishedId = await insertDeal("published", 99, "published");
});

afterAll(async () => {
  if (productId) await db.delete(products).where(eq(products.id, productId));
  if (categoryId) await db.delete(categories).where(eq(categories.id, categoryId));
  await closeQueues(queues);
  connection.disconnect();
  await db.$client.end();
});

describe("publishReadyDeals", () => {
  it("enqueues only auto_approved/approved deals, highest score first, excluding pending/rejected/published", async () => {
    const result = await publishReadyDeals(db, queues, { limit: 10 });

    expect(result.dealCandidateIds).toContain(autoApprovedHighId);
    expect(result.dealCandidateIds).toContain(autoApprovedLowId);
    expect(result.dealCandidateIds).toContain(approvedId);
    expect(result.dealCandidateIds).not.toContain(pendingId);
    expect(result.dealCandidateIds).not.toContain(publishedId);

    const highIndex = result.dealCandidateIds.indexOf(autoApprovedHighId);
    const lowIndex = result.dealCandidateIds.indexOf(autoApprovedLowId);
    expect(highIndex).toBeLessThan(lowIndex);
  });

  it("respects the limit", async () => {
    const result = await publishReadyDeals(db, queues, { limit: 1 });
    expect(result.enqueued).toBe(1);
    expect(result.dealCandidateIds).toEqual([autoApprovedHighId]);
  });

  it("actually enqueues a content-generation job for each returned deal", async () => {
    const before = await queues.contentGeneration.count();
    await publishReadyDeals(db, queues, { limit: 10 });
    const after = await queues.contentGeneration.count();
    expect(after).toBeGreaterThan(before);
  });
});
