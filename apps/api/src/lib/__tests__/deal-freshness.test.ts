import { describe, expect, it } from "vitest";
import { MAX_OFFER_AGE_MS, isOfferCurrent } from "../deal-freshness.js";

describe("isOfferCurrent", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");

  it("rejects an out-of-stock offer even when just captured", () => {
    expect(isOfferCurrent("out_of_stock", now, now)).toBe(false);
  });

  it("rejects an observation older than 72 hours", () => {
    const old = new Date(now.getTime() - MAX_OFFER_AGE_MS - 1);
    expect(isOfferCurrent("in_stock", old, now)).toBe(false);
  });

  it("keeps a recent offer with unknown availability visible", () => {
    expect(isOfferCurrent("unknown", now, now)).toBe(true);
  });
});
