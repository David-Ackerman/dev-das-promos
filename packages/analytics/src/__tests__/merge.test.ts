import { describe, expect, it } from "vitest";
import { mergeAnalyticsRows } from "../merge.js";

describe("mergeAnalyticsRows", () => {
  it("merges clicks and conversions that share a key", () => {
    const rows = mergeAnalyticsRows(
      [{ key: "telegram", label: "telegram", clicks: 100 }],
      [
        {
          key: "telegram",
          label: "telegram",
          conversions: 5,
          revenueCents: 50_000,
          commissionCents: 5_000,
        },
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      clicks: 100,
      conversions: 5,
      revenueCents: 50_000,
      commissionCents: 5_000,
    });
  });

  it("computes conversion rate and EPC from merged totals", () => {
    const rows = mergeAnalyticsRows(
      [{ key: "web", label: "web", clicks: 200 }],
      [
        {
          key: "web",
          label: "web",
          conversions: 10,
          revenueCents: 100_000,
          commissionCents: 10_000,
        },
      ],
    );
    expect(rows[0]?.conversionRate).toBeCloseTo(0.05, 5);
    expect(rows[0]?.epcCents).toBe(50);
  });

  it("reports a zero (not undefined) conversion rate for a click-only group", () => {
    const rows = mergeAnalyticsRows([{ key: "x", label: "x", clicks: 50 }], []);
    expect(rows[0]?.conversions).toBe(0);
    expect(rows[0]?.conversionRate).toBe(0);
  });

  it("keeps a conversion-only group with undefined rate/epc since there are no clicks to divide by", () => {
    const rows = mergeAnalyticsRows(
      [],
      [
        {
          key: "amazon_br",
          label: "amazon_br",
          conversions: 3,
          revenueCents: 9_000,
          commissionCents: 900,
        },
      ],
    );
    expect(rows[0]?.clicks).toBe(0);
    expect(rows[0]?.conversionRate).toBeUndefined();
    expect(rows[0]?.epcCents).toBeUndefined();
  });

  it("sorts rows by clicks descending", () => {
    const rows = mergeAnalyticsRows(
      [
        { key: "a", label: "a", clicks: 5 },
        { key: "b", label: "b", clicks: 50 },
      ],
      [],
    );
    expect(rows.map((r) => r.key)).toEqual(["b", "a"]);
  });

  it("handles an entirely empty input without throwing", () => {
    expect(mergeAnalyticsRows([], [])).toEqual([]);
  });
});
