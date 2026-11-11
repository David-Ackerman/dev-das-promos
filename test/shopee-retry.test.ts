import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchShopeeCandidates } from "../src/providers/shopee.ts";
import { mockFetch } from "./helpers.ts";

const cfg = { appId: "1", appSecret: "s", keywords: ["ssd", "webcam"], sortType: 2 } as never;
const node = { itemId: 1, productName: "SSD 1TB", productLink: "https://shopee.com.br/p", priceMin: "199.90", priceDiscountRate: 30 };
const systemError = { errors: [{ message: "System Error", extensions: { code: 10000, message: "System Error" } }] };

describe("Shopee search", () => {
  it("retries Shopee's System Error, and one bad keyword doesn't sink the others", async () => {
    let calls = 0;
    const f = mockFetch([
      ["affiliate.shopee", (c) => {
        calls++;
        if (c.body.variables.keyword === "webcam") return systemError;
        return calls === 1 ? systemError : { data: { productOfferV2: { nodes: [node] } } };
      }],
    ]);
    const logs: string[] = [];
    try {
      const out = await fetchShopeeCandidates(cfg, 20, (m) => logs.push(m));
      assert.equal(out.length, 1, "ssd worked on the retry");
      assert.ok(logs.some((l) => /"webcam" falhou: Shopee API error: System Error \[10000\]/.test(l)), logs.join("\n"));
    } finally {
      f.restore();
    }
  });

  it("fails only when every keyword failed", async () => {
    const f = mockFetch([["affiliate.shopee", () => systemError]]);
    try {
      await assert.rejects(fetchShopeeCandidates(cfg, 20), /System Error \[10000\]/);
    } finally {
      f.restore();
    }
  });
});
