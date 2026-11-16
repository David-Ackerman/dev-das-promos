import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickCandidates } from "../src/collect.ts";
import { DEFAULT_TOPICS, productKind, qualityProblem, topicsForRun } from "../src/quality.ts";
import type { Candidate } from "../src/types.ts";

const rules = { minPriceCents: 2500, audioMinCents: 25000, shopeeMinRating: 4.6, shopeeMinSales: 50 };
const c = (title: string, over: Partial<Candidate> = {}): Candidate => ({
  marketplace: "amazon", externalId: title, title, productUrl: "https://x", priceCents: 9900, originalPriceCents: 19900, discountPct: 50, ...over,
});

describe("deal quality", () => {
  it("earphones need a known brand and a full price of R$ 250+", () => {
    assert.equal(qualityProblem(c("Fone de Ouvido Bluetooth TWS i12", { priceCents: 2990, originalPriceCents: 5990 }), rules), "audio-cheap");
    assert.equal(qualityProblem(c("Fone Bluetooth Sem Fio Pro Max", { priceCents: 19900, originalPriceCents: 39900 }), rules), "audio-brand");
    assert.equal(qualityProblem(c("Fone JBL Tune 520BT", { priceCents: 19900, originalPriceCents: 29900 }), rules), undefined);
    assert.equal(qualityProblem(c("Headset Gamer HyperX Cloud III", { priceCents: 39900, originalPriceCents: undefined }), rules), undefined);
    assert.equal(qualityProblem(c("Galaxy Buds FE Samsung", { priceCents: 29900, originalPriceCents: 49900 }), rules), undefined);
  });

  it("skips trinkets and badly rated or unsold Shopee items", () => {
    assert.equal(qualityProblem(c("Calculadora de mesa", { priceCents: 1290 }), rules), "cheap");
    assert.equal(qualityProblem(c("Cortina LED 3m", { marketplace: "shopee", rating: 4.3, sales: 900 }), rules), "rating");
    assert.equal(qualityProblem(c("Cortina LED 3m", { marketplace: "shopee", rating: 4.9, sales: 12 }), rules), "sales");
    assert.equal(qualityProblem(c("Air Fryer Mondial 4L", { marketplace: "shopee", rating: 4.8, sales: 3000 }), rules), undefined);
  });

  it("groups the same kind of product", () => {
    assert.equal(productKind("Fone de Ouvido JBL"), "fone");
    assert.equal(productKind("Headset Gamer HyperX"), "fone");
    assert.equal(productKind("Kit 2x Perfume Árabe Lattafa"), "perfume");
    assert.equal(productKind("5x Blister Triplo Pokémon"), "pokemon");
    assert.equal(productKind("Cortinas LED Natal"), "cortina");
  });

  it("picks at most N of a kind, counting what already went out today", () => {
    const offers = [c("Fone JBL A"), c("Fone Sony B"), c("Fone Edifier C"), c("Air Fryer D"), c("Perfume E")];
    const picks = pickCandidates(offers, { limit: 10, minDiscountPct: 0, kindOf: (o) => productKind(o.title), maxPerKind: 2, kindCounts: new Map([["fone", 1]]) });
    assert.deepEqual(picks.map((p) => p.title).sort(), ["Air Fryer D", "Fone JBL A", "Perfume E"]);
  });

  it("each run searches a few different topics, not every keyword", () => {
    const six = 6 * 3600_000;
    const day = Date.UTC(2026, 10, 16);
    const runs = [0, 1, 2, 3].map((k) => topicsForRun(DEFAULT_TOPICS, 4, day + k * six));
    for (const r of runs) assert.equal(r.length, 4);
    assert.equal(new Set(runs.flat()).size, 16, "four runs, sixteen different topics");
    const shopee = topicsForRun(DEFAULT_TOPICS, 4, day, 1);
    assert.equal(shopee.filter((t) => runs[0]!.includes(t)).length, 0, "Shopee searches other topics than Amazon");
  });
});
