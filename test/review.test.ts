import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Caption } from "../src/ai.ts";
import { renderTelegram, renderWhatsApp, renderX } from "../src/render.ts";
import { lastJsonObject, nicheFit, reviewCaption, writeReviewedCaption } from "../src/review.ts";
import { qualityProblem } from "../src/quality.ts";
import type { Candidate } from "../src/types.ts";
import { mockFetch } from "./helpers.ts";

const ai = { baseUrl: "https://ai.test", apiKey: "k", models: ["m"], providers: {}, niche: "tech, games e setup" } as never;
const product: Candidate = { marketplace: "shopee", externalId: "1", title: "Cafeteira Elétrica Mondial", productUrl: "https://x", priceCents: 9990, originalPriceCents: 15990, discountPct: 38 };
const cap = (caption: string, model = "m"): Caption => ({ caption, short: caption, model });
const reply = (content: string) => () => ({ choices: [{ message: { content } }] });

describe("caption review", () => {
  it("keeps a line the reviewer approves", async () => {
    const out = await writeReviewedCaption(ai, product, {}, {
      generate: async () => cap("Café pronto antes do despertador"),
      review: async () => ({ ok: true, reason: "" }),
    });
    assert.equal(out.caption.caption, "Café pronto antes do despertador");
    assert.equal(out.needsAdmin, undefined);
  });

  it("rewrites with the reviewer's reason, and asks the admin when it's still bad", async () => {
    const asked: (string | undefined)[] = [];
    const lines = ["Cafeteira Mondial top demais", "Luxo absoluto pra sua casa"];
    const out = await writeReviewedCaption(ai, product, {}, {
      generate: async (_c, _p, _a, opts) => {
        asked.push(opts?.feedback?.reason);
        return cap(lines.shift()!);
      },
      review: async (_c, _p, text) => ({ ok: false, reason: text.includes("Mondial") ? "repete a marca" : "exagero pro preço" }),
    });
    assert.deepEqual(asked, [undefined, "repete a marca"]);
    assert.equal(out.needsAdmin, "exagero pro preço");
  });

  it("second line approved = no admin", async () => {
    let n = 0;
    const out = await writeReviewedCaption(ai, product, {}, {
      generate: async () => cap(n++ ? "Café de padaria em casa" : "Cafeteira Mondial top"),
      review: async (_c, _p, t) => ({ ok: !t.includes("Mondial"), reason: "repete a marca" }),
    });
    assert.equal(out.caption.caption, "Café de padaria em casa");
    assert.equal(out.needsAdmin, undefined);
  });

  it("reads the reviewer's JSON, even after some thinking", async () => {
    const f = mockFetch([["ai.test", reply('vou pensar {"x": 1}... resposta: {"ok": false, "motivo": "frase truncada"}')]]);
    try {
      assert.deepEqual(await reviewCaption(ai, product, "Café pronto antes"), { ok: false, reason: "frase truncada" });
      assert.match(f.to("ai.test")[0]!.body.messages[1].content, /Preço: de R\$\s159,90 por R\$\s99,90/);
    } finally {
      f.restore();
    }
    assert.deepEqual(lastJsonObject('a {"ok": true} b'), { ok: true });
  });

  it("no model answering never blocks a caption", async () => {
    const f = mockFetch([["ai.test", () => new Response("busy", { status: 503 })]]);
    try {
      assert.equal(await reviewCaption(ai, product, "Café pronto"), undefined);
    } finally {
      f.restore();
    }
  });
});

describe("theme of the channel", () => {
  it("marks off-theme products and gives each a theme", async () => {
    const items = [product, { ...product, externalId: "2", title: "Caneca de Café 350ml" }, { ...product, externalId: "3", title: "Teclado Mecânico Redragon" }];
    const f = mockFetch([["ai.test", reply('{"itens":[{"n":1,"ok":false,"tema":"Café"},{"n":2,"ok":false,"tema":"café"},{"n":3,"ok":true,"tema":"periférico gamer"}]}')]]);
    try {
      const v = await nicheFit(ai, items);
      assert.deepEqual(v, [{ ok: false, theme: "cafe" }, { ok: false, theme: "cafe" }, { ok: true, theme: "periferico gamer" }]);
      assert.match(f.to("ai.test")[0]!.body.messages[0].content, /tech, games e setup/);
    } finally {
      f.restore();
    }
  });

  it("underwear and adult items never pass", () => {
    const rules = { minPriceCents: 0, audioMinCents: 0, shopeeMinRating: 0, shopeeMinSales: 0 };
    assert.equal(qualityProblem({ ...product, title: "Conjunto Lingerie Renda" }, rules), "off-limits");
    assert.equal(qualityProblem({ ...product, title: "Kit 5 Calcinhas Algodão" }, rules), "off-limits");
    assert.equal(qualityProblem({ ...product, title: "Cueca Boxer Kit 3" }, rules), "off-limits");
  });
});

describe("post without a line", () => {
  const p = {
    caption: "", captionShort: "", title: "Teclado Mecânico Redragon Kumara", shortTitle: null, priceCents: 15990, originalPriceCents: 24990,
    discountPct: 36, marketplace: "amazon", link: "https://l/go/a", footer: "",
  } as never;
  it("starts with the name when the admin didn't write a line in time", () => {
    assert.match(renderTelegram(p), /^Teclado Mecânico Redragon Kumara\n\nDe <s>/);
    assert.match(renderWhatsApp(p), /^Teclado Mecânico Redragon Kumara\n\nDe ~/);
    assert.match(renderX(p, "https://l/go/a"), /^Teclado Mecânico Redragon Kumara por/);
  });
});
