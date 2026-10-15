import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { cleanAiText, generateCaption, parseAiJson, templateCaption } from "../src/ai.ts";
import { pickCandidates } from "../src/collect.ts";
import { amazonItemToCandidate, fetchAmazonCandidates } from "../src/providers/amazon.ts";
import { shopeeNodeToCandidate } from "../src/providers/shopee.ts";
import { oauthHeader } from "../src/publishers/x.ts";
import { renderTelegram, renderWhatsApp, renderX, xLength } from "../src/render.ts";
import type { Candidate } from "../src/types.ts";
import { brl, discountPct, toCents } from "../src/util.ts";
import { createHandler } from "../src/http.ts";
import { mockFetch, testConfig } from "./helpers.ts";

const cand = (over: Partial<Candidate>): Candidate => ({
  marketplace: "shopee",
  externalId: Math.random().toString(),
  title: "Produto",
  productUrl: "https://shopee.com.br/x",
  priceCents: 10000,
  discountPct: 30,
  ...over,
});

describe("money", () => {
  it("parses and formats BRL", () => {
    assert.equal(toCents("129.90"), 12990);
    assert.equal(toCents("R$ 1.299,90"), 129990);
    assert.equal(toCents(59.9), 5990);
    assert.equal(toCents(""), undefined);
    assert.equal(brl(129990).replace(/\s/g, " "), "R$ 1.299,90");
    assert.equal(discountPct(7000, 10000), 30);
    assert.equal(discountPct(7000, undefined), 0);
  });
});

describe("render", () => {
  const input = {
    caption: "Café <forte> & barato",
    captionShort: "Seu café, mais barato ☕".repeat(5),
    title: "Cafeteira Elétrica Super Mega Blaster 3000 Inox Programável com Jarra Térmica".repeat(2),
    marketplace: "amazon" as const,
    priceCents: 19990,
    originalPriceCents: 29990,
    discountPct: 33,
    link: "https://promo.example.workers.dev/go/abc1234",
    footer: "#publi · link de afiliado",
  };
  it("escapes HTML for Telegram and shows the price", () => {
    const t = renderTelegram(input);
    assert.match(t, /Café &lt;forte&gt; &amp; barato/);
    assert.match(t, /<s>R\$\s299,90<\/s> por <b>R\$\s199,90<\/b> \(-33%\)/);
    assert.match(t, /go\/abc1234/);
  });
  it("uses WhatsApp formatting", () => {
    assert.match(renderWhatsApp(input), /~R\$\s299,90~ por \*R\$\s199,90\*/);
  });
  it("keeps X posts within 280 chars, link or not", () => {
    const withLink = renderX(input, input.link);
    assert.ok(xLength(withLink) <= 280, `len ${xLength(withLink)}`);
    assert.match(withLink, /go\/abc1234/);
    const noLink = renderX(input, "🔗 Link na bio");
    assert.ok(!noLink.includes("http"));
    assert.ok(xLength(noLink) <= 280);
  });
});

describe("selection", () => {
  it("filters by discount, dedupes, alternates stores", () => {
    const list = [
      cand({ externalId: "s1", discountPct: 60 }),
      cand({ externalId: "s1", discountPct: 60 }),
      cand({ externalId: "s2", discountPct: 50 }),
      cand({ externalId: "s3", discountPct: 10 }),
      cand({ externalId: "a1", marketplace: "amazon", discountPct: 25 }),
    ];
    const picked = pickCandidates(list, { limit: 3, minDiscountPct: 20 });
    assert.deepEqual(
      picked.map((c) => c.externalId),
      ["s1", "a1", "s2"],
    );
    const excluded = pickCandidates(list, { limit: 3, minDiscountPct: 20, exclude: (c) => c.externalId === "s1" });
    assert.ok(!excluded.some((c) => c.externalId === "s1"));
  });
});

describe("providers", () => {
  it("maps a Shopee node", () => {
    const c = shopeeNodeToCandidate({
      itemId: 123,
      productName: "Fone",
      productLink: "https://shopee.com.br/product/1/123",
      priceMin: "70.00",
      priceDiscountRate: 30,
      sales: 1500,
      ratingStar: "4.8",
      commissionRate: "0.1",
    });
    assert.equal(c?.priceCents, 7000);
    assert.equal(c?.originalPriceCents, 10000);
    assert.equal(c?.discountPct, 30);
    assert.equal(shopeeNodeToCandidate({ itemId: 1, productName: "x", productLink: "y", priceMin: "0" }), null);
  });
  it("only accepts Amazon links carrying our tag", () => {
    const item = {
      asin: "B0TEST",
      detailPageURL: "https://www.amazon.com.br/dp/B0TEST?tag=meu-20",
      itemInfo: { title: { displayValue: "Air Fryer" } },
      offersV2: { listings: [{ price: { money: { amount: 299.9, currency: "BRL" }, savingBasis: { money: { amount: 499.9 } } } }] },
    };
    const c = amazonItemToCandidate(item, "meu-20");
    assert.equal(c?.priceCents, 29990);
    assert.equal(c?.discountPct, 40);
    assert.equal(amazonItemToCandidate(item, "outro-20"), null);
  });
  it("asks Amazon only for resources it accepts", async () => {
    // Subset of the enum the Creators API lists in its 400 error.
    const accepted = new Set(["images.primary.large", "itemInfo.title", "offersV2.listings.price", "offersV2.listings.availability"]);
    const f = mockFetch([
      ["auth/o2/token", () => ({ access_token: "t", expires_in: 3600 })],
      ["searchItems", () => ({ searchResult: { items: [] } })],
    ]);
    try {
      await fetchAmazonCandidates({ clientId: "c", clientSecret: "s", partnerTag: "meu-20", keywords: ["fone"], tokenUrl: "https://api.amazon.com/auth/o2/token" });
      const resources: string[] = f.to("searchItems")[0]!.body.resources;
      for (const r of resources) assert.ok(accepted.has(r), `Amazon rejects resource "${r}"`);
      assert.equal(f.to("searchItems")[0]!.headers.authorization, "Bearer t");
    } finally {
      f.restore();
    }
  });
});

describe("ai", () => {
  it("parses fenced JSON and strips links/prices/hashtags", () => {
    const parsed = parseAiJson('```json\n{"texto":"Olha isso www.site.com por R$ 10,00 #promo","tweet":"oi"}\n```');
    assert.equal(cleanAiText(parsed.texto, 300), "Olha isso por");
  });
  it("falls back to a template when the AI fails", async () => {
    const f = mockFetch([["chat/completions", () => new Response("boom", { status: 500 })]]);
    try {
      const c = await generateCaption(testConfig().ai, cand({}));
      assert.equal(c.model, "template");
      assert.ok(c.caption.length > 5);
      assert.match(c.error ?? "", /HTTP 500/);
    } finally {
      f.restore();
    }
  });
});

describe("ai fallback", () => {
  const ok = { choices: [{ message: { content: '{"texto":"Oi","tweet":"Oi"}' } }] };
  it("retries a busy model once, then moves to the next one", async () => {
    const tried: string[] = [];
    const f = mockFetch([["chat/completions", (c) => {
      tried.push(c.body.model);
      return c.body.model === "busy:free" ? new Response(JSON.stringify({ error: { message: "Provider returned error" } }), { status: 429 }) : ok;
    }]]);
    try {
      const c = await generateCaption(testConfig({ AI_MODEL: "busy:free, spare:free" }).ai, cand({}));
      assert.equal(c.model, "spare:free");
      assert.equal(c.error, undefined);
      assert.deepEqual(tried, ["busy:free", "busy:free", "spare:free"]);
    } finally {
      f.restore();
    }
  });
  it("skips a broken model without retrying and reports every failure", async () => {
    const tried: string[] = [];
    const f = mockFetch([["chat/completions", (c) => {
      tried.push(c.body.model);
      return new Response(JSON.stringify({ error: { message: "nope" } }), { status: 403 });
    }]]);
    try {
      const c = await generateCaption(testConfig({ AI_MODEL: "a:free,b:free" }).ai, cand({}));
      assert.equal(c.model, "template");
      assert.deepEqual(tried, ["a:free", "b:free"]);
      assert.match(c.error!, /a:free: HTTP 403 nope \| b:free: HTTP 403 nope/);
    } finally {
      f.restore();
    }
  });
});

describe("templates", () => {
  it("never repeats the text it was asked to avoid", () => {
    const current = templateCaption({ title: "x" }, 0).caption;
    for (let seed = 0; seed < 20; seed++) assert.notEqual(templateCaption({ title: "x" }, seed, current).caption, current);
  });
});

describe("x oauth", () => {
  it("builds a signed OAuth 1.0a header", async () => {
    const h = await oauthHeader(
      "POST",
      "https://api.x.com/2/tweets",
      { apiKey: "ck", apiSecret: "cs", accessToken: "at", accessTokenSecret: "ats" },
      "nonce",
      "1700000000",
    );
    assert.match(h, /^OAuth oauth_consumer_key="ck", oauth_nonce="nonce", oauth_signature="[^"]+", oauth_signature_method="HMAC-SHA1"/);
    // Same inputs -> same signature (deterministic HMAC).
    const again = await oauthHeader("POST", "https://api.x.com/2/tweets", { apiKey: "ck", apiSecret: "cs", accessToken: "at", accessTokenSecret: "ats" }, "nonce", "1700000000");
    assert.equal(h, again);
  });
});

describe("scheduled search", () => {
  const run = async (overrides: Record<string, string>, routes: Parameters<typeof mockFetch>[0]) => {
    const cfg = testConfig(overrides);
    const handler = createHandler(() => ({ cfg, db: { query: async () => [] } }));
    const waits: Promise<unknown>[] = [];
    const f = mockFetch(routes);
    try {
      await handler.scheduled({}, {}, { waitUntil: (p) => void waits.push(p) });
      await Promise.all(waits);
      return f;
    } finally {
      f.restore();
    }
  };
  it("starts the Collect workflow through GitHub's API", async () => {
    const f = await run({ GH_DISPATCH_TOKEN: "ghp_x", GH_REPO: "me/repo" }, [["api.github.com", () => new Response(null, { status: 204 })]]);
    const call = f.to("api.github.com")[0]!;
    assert.equal(call.url, "https://api.github.com/repos/me/repo/actions/workflows/collect.yml/dispatches");
    assert.equal(call.headers.authorization, "Bearer ghp_x");
    assert.deepEqual(call.body, { ref: "main" });
    assert.equal(f.to("api.telegram.org").length, 0, "no message when it worked");
  });
  it("warns the admin when it can't start the search", async () => {
    const missing = await run({}, [["api.telegram.org", () => ({ ok: true, result: { message_id: 1 } })]]);
    assert.match(missing.to("sendMessage")[0]!.body.text, /Busca agendada: Configure GH_DISPATCH_TOKEN/);
    const denied = await run({ GH_DISPATCH_TOKEN: "bad", GH_REPO: "me/repo" }, [
      ["api.github.com", () => new Response("{}", { status: 401 })],
      ["api.telegram.org", () => ({ ok: true, result: { message_id: 1 } })],
    ]);
    assert.match(denied.to("sendMessage")[0]!.body.text, /HTTP 401/);
  });
});

describe("migrations never destroy data", () => {
  it("contains no DROP / TRUNCATE / DELETE", () => {
    const dir = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(dir)) {
      const sql = readFileSync(new URL(file, dir), "utf8").replace(/--.*$/gm, "");
      assert.doesNotMatch(sql, /\b(DROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i, file);
    }
  });
});
