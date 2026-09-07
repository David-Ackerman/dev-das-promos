import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase, getDb } from "../client.js";
import { categories } from "../schema/index.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/das_promos";

describe("createDatabase", () => {
  const db = createDatabase(databaseUrl);

  afterAll(async () => {
    await db.$client.end();
  });

  it("returns a working drizzle instance that can query the database", async () => {
    const rows = await db.select({ count: sql<number>`count(*)` }).from(categories);

    expect(rows).toHaveLength(1);
    const count = Number(rows[0]?.count);
    expect(typeof count).toBe("number");
    expect(Number.isNaN(count)).toBe(false);
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

describe("getDb", () => {
  it("returns the same singleton instance on repeated calls with the same url", async () => {
    const first = getDb(databaseUrl);
    const second = getDb(databaseUrl);

    expect(second).toBe(first);

    // A trivial query to confirm the singleton is actually a working connection.
    const rows = await first.select({ count: sql<number>`count(*)` }).from(categories);
    expect(rows).toHaveLength(1);

    await first.$client.end();
  });
});
