import { randomUUID } from "node:crypto";
import { conversions, createDatabase } from "@dev-das-promos/database";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getConversionAggregates } from "../conversion-aggregates.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/das_promos";

const db = createDatabase(databaseUrl);

const testId = randomUUID();
let insertedIds: string[] = [];

beforeAll(async () => {
  const rows = await db
    .insert(conversions)
    .values([
      {
        marketplace: "amazon_br",
        orderReference: `test-conv-${testId}-1`,
        revenueCents: 10_000,
        commissionCents: 500,
        occurredAt: new Date(),
      },
      {
        marketplace: "shopee_br",
        orderReference: `test-conv-${testId}-2`,
        revenueCents: 20_000,
        commissionCents: 1_000,
        occurredAt: new Date(),
      },
    ])
    .returning({ id: conversions.id });
  insertedIds = rows.map((r) => r.id);
});

afterAll(async () => {
  if (insertedIds.length) {
    await db.delete(conversions).where(inArray(conversions.id, insertedIds));
  }
  await db.$client.end();
});

describe("getConversionAggregates channel dimension", () => {
  it("rolls every conversion into a single 'unattributed' bucket instead of erroring", async () => {
    const rows = await getConversionAggregates(db, "channel", {});
    const mine = rows.find((r) => r.key === "unattributed");

    expect(mine).toBeDefined();
    expect(mine!.conversions).toBeGreaterThanOrEqual(2);
  });
});
