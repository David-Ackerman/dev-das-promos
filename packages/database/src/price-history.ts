import { sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { offers } from "./schema/offer.js";

export interface PriceHistorySummary {
  marketplaceProductId: string;
  currentPriceCents: number | undefined;
  currentEffectivePriceCents: number | undefined;
  avg7dCents: number | undefined;
  avg30dCents: number | undefined;
  avg90dCents: number | undefined;
  min30dCents: number | undefined;
  min90dCents: number | undefined;
  historicalMinCents: number | undefined;
  sampleCount: number;
}

/**
 * Price history is deliberately DERIVED from `offers` rather than stored
 * redundantly: every aggregate below is computed straight from the raw
 * observation table with one query, using PostgreSQL FILTER clauses so
 * all the windows are computed together instead of N round-trips. This
 * keeps the aggregates impossible to drift out of sync with the source
 * data (there is nothing to keep in sync).
 */
export async function getPriceHistorySummary(
  db: Database,
  marketplaceProductId: string,
): Promise<PriceHistorySummary> {
  const rows = await db
    .select({
      currentPriceCents: sql<number | null>`
        (array_agg(${offers.priceCents} ORDER BY ${offers.capturedAt} DESC))[1]
      `,
      currentEffectivePriceCents: sql<number | null>`
        (array_agg(${offers.effectivePriceCents} ORDER BY ${offers.capturedAt} DESC))[1]
      `,
      avg7dCents: sql<number | null>`
        avg(${offers.effectivePriceCents}) FILTER (WHERE ${offers.capturedAt} >= now() - interval '7 days')
      `,
      avg30dCents: sql<number | null>`
        avg(${offers.effectivePriceCents}) FILTER (WHERE ${offers.capturedAt} >= now() - interval '30 days')
      `,
      avg90dCents: sql<number | null>`
        avg(${offers.effectivePriceCents}) FILTER (WHERE ${offers.capturedAt} >= now() - interval '90 days')
      `,
      min30dCents: sql<number | null>`
        min(${offers.effectivePriceCents}) FILTER (WHERE ${offers.capturedAt} >= now() - interval '30 days')
      `,
      min90dCents: sql<number | null>`
        min(${offers.effectivePriceCents}) FILTER (WHERE ${offers.capturedAt} >= now() - interval '90 days')
      `,
      historicalMinCents: sql<number | null>`min(${offers.effectivePriceCents})`,
      sampleCount: sql<number>`count(*)`,
    })
    .from(offers)
    .where(sql`${offers.marketplaceProductId} = ${marketplaceProductId}`);

  const row = rows[0];

  const toNum = (v: number | string | null | undefined) =>
    v === null || v === undefined ? undefined : Number(v);

  return {
    marketplaceProductId,
    currentPriceCents: toNum(row?.currentPriceCents),
    currentEffectivePriceCents: toNum(row?.currentEffectivePriceCents),
    avg7dCents:
      toNum(row?.avg7dCents) !== undefined ? Math.round(toNum(row?.avg7dCents)!) : undefined,
    avg30dCents:
      toNum(row?.avg30dCents) !== undefined ? Math.round(toNum(row?.avg30dCents)!) : undefined,
    avg90dCents:
      toNum(row?.avg90dCents) !== undefined ? Math.round(toNum(row?.avg90dCents)!) : undefined,
    min30dCents: toNum(row?.min30dCents),
    min90dCents: toNum(row?.min90dCents),
    historicalMinCents: toNum(row?.historicalMinCents),
    sampleCount: toNum(row?.sampleCount) ?? 0,
  };
}

export interface PricePoint {
  capturedAt: Date;
  effectivePriceCents: number;
}

/** Raw time series for chart rendering, bounded to a lookback window. */
export async function getPriceSeries(
  db: Database,
  marketplaceProductId: string,
  days: number | "all",
): Promise<PricePoint[]> {
  const whereClause =
    days === "all"
      ? sql`${offers.marketplaceProductId} = ${marketplaceProductId}`
      : sql`${offers.marketplaceProductId} = ${marketplaceProductId} AND ${offers.capturedAt} >= now() - ${sql.raw(
          `interval '${Math.trunc(days)} days'`,
        )}`;

  const rows = await db
    .select({
      capturedAt: offers.capturedAt,
      effectivePriceCents: offers.effectivePriceCents,
    })
    .from(offers)
    .where(whereClause)
    .orderBy(offers.capturedAt);

  return rows;
}
