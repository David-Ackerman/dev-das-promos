import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { cleanAiText, cleanHashtag, generateCaption, parseAiJson, parseAiReply, resolveModel, shortCaption, templateCaption } from "../src/ai.ts";
import { loadAiConfig } from "../src/config.ts";
import { commissionCents, isBlocked, isFakeDiscount, pickCandidates, score } from "../src/collect.ts";
import { amazonItemToCandidate, fetchAmazonCandidates } from "../src/providers/amazon.ts";
import { shopeeNodeToCandidate } from "../src/providers/shopee.ts";
import { oauthHeader } from "../src/publishers/x.ts";
import { renderTelegram, renderWhatsApp, renderX, xLength } from "../src/render.ts";
import type { Candidate } from "../src/types.ts";
import { brl, discountPct, toCents } from "../src/util.ts";
import { createHandler, QUEUE_CRON, ROUNDUP_CRON } from "../src/http.ts";
import { comparePrice } from "../src/pricecheck.ts";
import { siteSource } from "../src/site.ts";
import { socialCaption, stripEmoji, videoFilter, wrapLines } from "../src/video.ts";
import { planXPost } from "../src/publish.ts";
import { bestImageUrl } from "../src/publishers/x.ts";
import { fetchShopeeItem } from "../src/providers/shopee.ts";
import { formatSlot, nextSlot, parsePostingHours } from "../src/schedule.ts";
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
  it("adds one product hashtag on X only when it fits, never at the joke's expense", () => {
    const short = { ...input, captionShort: "Leia mais, gaste menos 📚", title: "Kindle 11ª geração" };
    assert.match(renderX({ ...short, hashtag: "Kindle" }, input.link), /\n#publi #Kindle$/);
    assert.doesNotMatch(renderTelegram({ ...short, hashtag: "Kindle" }), /#Kindle/, "Telegram stays as it was");
    const long = { ...input, captionShort: "x".repeat(180), hashtag: "Kindle" };
    const text = renderX(long, input.link);
    assert.ok(xLength(text) <= 280, `len ${xLength(text)}`);
    assert.ok(!text.includes("#Kindle"), "hashtag dropped first");
    assert.ok(text.includes("x".repeat(180)), "joke kept whole");
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

describe("publishing queue timing", () => {
  const q = { intervalMinutes: 40, startHour: 8, endHour: 23 };
  const brt = (iso: string) => new Date(`${iso}-03:00`);
  it("spaces posts and keeps them inside the posting window", () => {
    assert.equal(nextSlot(brt("2026-10-15T14:00:00"), null, q).toISOString(), brt("2026-10-15T14:00:00").toISOString());
    assert.equal(nextSlot(brt("2026-10-15T14:00:00"), brt("2026-10-15T13:50:00"), q).toISOString(), brt("2026-10-15T14:30:00").toISOString());
    assert.equal(nextSlot(brt("2026-10-15T06:10:00"), null, q).toISOString(), brt("2026-10-15T08:00:00").toISOString(), "before opening");
    assert.equal(nextSlot(brt("2026-10-15T22:40:00"), brt("2026-10-15T22:30:00"), q).toISOString(), brt("2026-10-16T08:00:00").toISOString(), "after closing");
    assert.equal(nextSlot(brt("2026-10-15T23:30:00"), null, q).toISOString(), brt("2026-10-16T08:00:00").toISOString());
  });
  it("formats slots and reads POSTING_HOURS", () => {
    const now = brt("2026-10-15T21:00:00");
    assert.equal(formatSlot(brt("2026-10-15T22:10:00"), now), "22:10");
    assert.equal(formatSlot(brt("2026-10-16T08:00:00"), now), "amanhã 08:00");
    assert.equal(formatSlot(brt("2026-10-18T08:00:00"), now), "18/10 08:00");
    assert.deepEqual(parsePostingHours("9 - 22"), { startHour: 9, endHour: 22 });
    assert.deepEqual(parsePostingHours(undefined), { startHour: 8, endHour: 23 });
    assert.throws(() => parsePostingHours("22-8"), /POSTING_HOURS/);
  });
});

describe("price check", () => {
  it("treats 2% either way as the same price", () => {
    assert.equal(comparePrice(10000, 10150), "same");
    assert.equal(comparePrice(10000, 10300), "higher");
    assert.equal(comparePrice(10000, 9700), "lower");
  });
  it("asks Shopee for exactly one item and tells 'gone' from 'unclear'", async () => {
    const shopee = { appId: "a", appSecret: "s", keywords: [], sortType: 2 };
    const node = { itemId: 123, productName: "Fone", productLink: "https://shopee.com.br/p", priceMin: "59.90", priceDiscountRate: 40 };
    let answer: unknown = { data: { productOfferV2: { nodes: [node] } } };
    const f = mockFetch([["affiliate.shopee", () => answer]]);
    try {
      assert.equal((await fetchShopeeItem(shopee, "123"))?.priceCents, 5990);
      assert.match(f.calls[0]!.body.query, /productOfferV2\(itemId: 123,/);
      answer = { data: { productOfferV2: { nodes: [] } } };
      assert.equal(await fetchShopeeItem(shopee, "123"), undefined, "no longer offered");
      answer = { data: { productOfferV2: { nodes: [{ ...node, itemId: 999 }] } } };
      assert.equal(await fetchShopeeItem(shopee, "123"), null, "filter ignored: unclear, not gone");
      assert.equal(await fetchShopeeItem(shopee, "12; drop"), null, "only digits are inlined");
    } finally {
      f.restore();
    }
  });
});

describe("ranking", () => {
  it("counts what a sale pays, without letting commission beat a much better discount", () => {
    const cheapLowRate = cand({ priceCents: 5000, discountPct: 30, commissionRate: 0.02 });
    const sameHighRate = cand({ priceCents: 5000, discountPct: 30, commissionRate: 0.12 });
    assert.ok(score(sameHighRate) > score(cheapLowRate), "higher commission wins a tie");
    assert.equal(commissionCents(cand({ priceCents: 10000, commissionRate: 8 })), 800, "percent values work too");
    const pricey = cand({ priceCents: 500000, discountPct: 20, commissionRate: 0.1 });
    const bigDiscount = cand({ priceCents: 5000, discountPct: 45, commissionRate: 0.02 });
    assert.ok(score(bigDiscount) > score(pricey), "commission is capped");
  });
  it("calls a discount fake when the product was cheaper recently", () => {
    assert.equal(isFakeDiscount(10000, 8000), true);
    assert.equal(isFakeDiscount(10000, 9900), false, "2% tolerance");
    assert.equal(isFakeDiscount(10000, undefined), false, "no history");
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
  const ok = { choices: [{ message: { content: '{"texto":"Oi, olha essa oferta","tweet":"Oi"}' } }] };
  it("moves on from a busy model at once instead of retrying it first", async () => {
    const tried: string[] = [];
    const f = mockFetch([["chat/completions", (c) => {
      tried.push(c.body.model);
      return c.body.model === "busy:free" ? new Response(JSON.stringify({ error: { message: "Provider returned error" } }), { status: 429 }) : ok;
    }]]);
    try {
      const c = await generateCaption(testConfig({ AI_MODEL: "busy:free, spare:free" }).ai, cand({}));
      assert.equal(c.model, "spare:free");
      assert.equal(c.error, undefined);
      assert.deepEqual(tried, ["busy:free", "spare:free"]);
    } finally {
      f.restore();
    }
  });
  it("treats an overloaded provider (503) like a busy one", async () => {
    let calls = 0;
    const f = mockFetch([["chat/completions", () => (++calls === 1 ? new Response("{}", { status: 503 }) : ok)]]);
    try {
      const c = await generateCaption(testConfig({ AI_MODEL: "only:free" }).ai, cand({}), undefined, { budgetMs: 10_000 });
      assert.equal(c.model, "only:free", "retried after the first round");
      assert.equal(calls, 2);
    } finally {
      f.restore();
    }
  });
  it("gives busy models a second go after trying every model once", async () => {
    const tried: string[] = [];
    const f = mockFetch([["chat/completions", (c) => {
      tried.push(c.body.model);
      const busyAgain = c.body.model === "a:free" || tried.length <= 3;
      return busyAgain ? new Response("{}", { status: 429 }) : ok;
    }]]);
    try {
      const c = await generateCaption(testConfig({ AI_MODEL: "a:free,b:free,c:free" }).ai, cand({}));
      assert.deepEqual(tried, ["a:free", "b:free", "c:free", "a:free", "b:free"]);
      assert.equal(c.model, "b:free");
    } finally {
      f.restore();
    }
  });
  it("accepts reasoning blocks and plain-text replies, and names the model on every error", async () => {
    assert.deepEqual(parseAiReply('<think>hmm, JSON...</think>{"texto":"Oi","tweet":"Tchau"}'), { texto: "Oi", tweet: "Tchau", tag: undefined });
    assert.deepEqual(parseAiReply('"Seu setup pedindo upgrade"'), { texto: "Seu setup pedindo upgrade", tweet: "Seu setup pedindo upgrade" });
    assert.throws(() => parseAiReply("<think>só pensou</think>"), /empty reply/);
    const f = mockFetch([["chat/completions", (c) =>
      c.body.model === "x:free" ? { choices: [{ message: { content: null } }] } : { choices: [{ message: { content: [{ type: "text", text: "Texto solto" }] } }] }]]);
    try {
      const c = await generateCaption(testConfig({ AI_MODEL: "x:free,y:free" }).ai, cand({}));
      assert.equal(c.caption, "Texto solto");
      assert.equal(c.model, "y:free");
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

describe("niche", () => {
  it("blocks whole words and phrases, ignoring accents and case", () => {
    const blocked = ["capa", "película", "kit 10"];
    assert.ok(isBlocked("Capinha + Capa Anti Impacto iPhone", blocked));
    assert.ok(isBlocked("Pelicula 3D Vidro", blocked), "accent-insensitive");
    assert.ok(isBlocked("Cabo USB-C Kit 10 Unidades", blocked));
    assert.ok(!isBlocked("Power Bank 20000mAh Alta Capacidade", blocked), "capa is not capacidade");
    assert.ok(!isBlocked("Fone Bluetooth", []));
  });
  it("tells the AI who the group is for", async () => {
    const f = mockFetch([["chat/completions", () => ({ choices: [{ message: { content: '{"texto":"Oi, olha essa oferta","tweet":"Oi"}' } }] })]]);
    try {
      await generateCaption(testConfig({ NICHE: "gamers e fãs de tecnologia" }).ai, cand({}));
      const [system, user] = f.to("chat/completions")[0]!.body.messages;
      assert.match(system.content, /Público do grupo/);
      assert.match(user.content, /^Público do grupo: gamers e fãs de tecnologia\nProduto:/);
    } finally {
      f.restore();
    }
  });
});

describe("ai providers", () => {
  it("sends prefixed models to their own provider and key", async () => {
    const ai = loadAiConfig({ AI_API_KEY: "or-key", GROQ_API_KEY: "gq-key", AI_MODEL: "groq:openai/gpt-oss-20b,google/gemma:free,gemini:gemini-flash" });
    assert.deepEqual(
      ai.models.map((m) => resolveModel(ai, m)).map((e) => [e.baseUrl, e.model, e.apiKey]),
      [
        ["https://api.groq.com/openai/v1", "openai/gpt-oss-20b", "gq-key"],
        ["https://openrouter.ai/api/v1", "google/gemma:free", "or-key"],
        ["https://generativelanguage.googleapis.com/v1beta/openai", "gemini-flash", undefined],
      ],
    );
    const urls: string[] = [];
    const f = mockFetch([["chat/completions", (c) => {
      urls.push(`${c.url} ${c.headers.authorization}`);
      return { choices: [{ message: { content: '{"texto":"Seu setup agradece esse upgrade","tweet":"Upgrade!"}' } }] };
    }]]);
    try {
      const c = await generateCaption(ai, cand({}));
      assert.equal(c.model, "groq:openai/gpt-oss-20b");
      assert.deepEqual(urls, ["https://api.groq.com/openai/v1/chat/completions Bearer gq-key"], "gemini skipped: no key");
    } finally {
      f.restore();
    }
  });
  it("reads the answer from the reasoning when content is empty, and rejects replies that aren't captions", async () => {
    const replies = [
      { content: "", reasoning: 'Vou escrever... {"texto":"Pensei bastante e esse fone é top","tweet":"Top"}' },
      { content: "..." },
    ];
    let i = 0;
    const f = mockFetch([["chat/completions", () => ({ choices: [{ message: replies[i++] }] })]]);
    try {
      const c = await generateCaption(testConfig({ AI_MODEL: "a:free" }).ai, cand({}));
      assert.equal(c.caption, "Pensei bastante e esse fone é top");
      const short = await generateCaption(testConfig({ AI_MODEL: "a:free" }).ai, cand({}));
      assert.equal(short.model, "template");
      assert.match(short.error!, /reply too short/);
    } finally {
      f.restore();
    }
  });
});

describe("short captions", () => {
  it("keeps two sentences at most, emojis included, and caps the length", () => {
    assert.equal(
      shortCaption("Seu setup pedindo socorro? 🎮 Esse fone resolve. O JBL Tune 520BT tem Bluetooth 5.3 e 57h de bateria.", 2, 160),
      "Seu setup pedindo socorro? 🎮 Esse fone resolve.",
    );
    assert.equal(shortCaption("Uma frase só, sem ponto final", 2, 160), "Uma frase só, sem ponto final");
    assert.ok(shortCaption("a".repeat(300), 2, 160).length <= 160);
  });
});

describe("hashtags", () => {
  it("keeps one brand/product word and rejects generic tags", () => {
    assert.equal(cleanHashtag("#Kindle"), "Kindle");
    assert.equal(cleanHashtag("Echo Dot"), "EchoDot");
    assert.equal(cleanHashtag("Promoção"), undefined);
    assert.equal(cleanHashtag("#publi"), undefined);
    assert.equal(cleanHashtag("2024"), undefined);
    assert.equal(cleanHashtag(""), undefined);
    assert.equal(parseAiJson('{"texto":"Oi, olha essa oferta","tweet":"Oi","tag":"JBL"}').tag, "JBL");
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
      await handler.scheduled({ cron: "7 0,12,15,18,21 * * *" }, {}, { waitUntil: (p) => void waits.push(p) });
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

describe("site assets", () => {
  it("ships every image the page references", () => {
    for (const file of ["banner.webp", "banner-1000.webp", "og.jpg"]) {
      assert.ok(readFileSync(new URL(`../public/${file}`, import.meta.url)).length > 1000, file);
    }
    assert.match(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8"), /\[assets\]\s*directory = "\.\/public"/);
  });
});

describe("X thread rules", () => {
  const cfg = testConfig({ X_MODE: "thread", X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c", X_ACCESS_TOKEN_SECRET: "d" });
  const post = (marketplace: string, title = "Fone Bluetooth") => ({ marketplace, title }) as never;
  const usage = (over: Partial<import("../src/repo.ts").XUsage> = {}) => ({
    postsToday: 0, byStoreToday: {}, spentTodayUsd: 0, spentMonthUsd: 0, postsMonth: 0, repliesMonth: 0, ...over,
  });
  const oct = new Date("2026-10-16T15:00:00Z"); // 31 days: $10 / 31 ≈ $0.32 a day
  it("gives the day's first deal the link reply, later ones only the post, within the daily share", () => {
    assert.deepEqual(planXPost(cfg, post("shopee"), usage(), oct), { post: true, reply: true });
    const afterFirst = usage({ postsToday: 1, byStoreToday: { shopee: 1 }, spentTodayUsd: 0.215, spentMonthUsd: 0.215 });
    assert.deepEqual(planXPost(cfg, post("amazon"), afterFirst, oct), { post: true, reply: false });
  });
  it("one slot per store, extra slots for Amazon / Mercado Livre, Shopee extras only for hardware", () => {
    const shopeeDone = usage({ postsToday: 1, byStoreToday: { shopee: 1 }, spentTodayUsd: 0.015 });
    assert.equal(planXPost(cfg, post("shopee", "Fone Bluetooth"), shopeeDone, oct).post, false);
    assert.equal(planXPost(cfg, post("shopee", "Placa-Mãe B550 AM4"), shopeeDone, oct).post, true);
    const amazonDone = usage({ postsToday: 1, byStoreToday: { amazon: 1 }, spentTodayUsd: 0.015 });
    assert.equal(planXPost(cfg, post("amazon"), amazonDone, oct).post, true);
  });
  it("stops at the daily limit and the monthly budget", () => {
    assert.match(planXPost(cfg, post("amazon"), usage({ postsToday: 3 }), oct).reason!, /limite de 3/);
    assert.match(planXPost(cfg, post("amazon"), usage({ spentMonthUsd: 9.99 }), oct).reason!, /orçamento/);
  });
  it("uses the biggest version of each store's photo", () => {
    assert.equal(bestImageUrl("https://m.media-amazon.com/images/I/61ev._AC_SX300_SY300_.jpg"), "https://m.media-amazon.com/images/I/61ev._AC_SL1500_.jpg");
    assert.equal(bestImageUrl("https://http2.mlstatic.com/D_NQ_NP_8812-MLA1-V.webp"), "https://http2.mlstatic.com/D_NQ_NP_8812-MLA1-O.jpg");
    assert.equal(bestImageUrl("https://down-br.img.susercontent.com/file/abc123_tn"), "https://down-br.img.susercontent.com/file/abc123");
  });
});

describe("site sources", () => {
  it("allow-lists ?src= and spots Google visits", () => {
    assert.equal(siteSource("X", null), "x");
    assert.equal(siteSource("instagram-bio-promo", null), "other", "junk can't create new rows");
    assert.equal(siteSource(null, "https://www.google.com.br/"), "google");
    assert.equal(siteSource(null, "https://t.co/abc"), "");
    assert.equal(siteSource(null, null), "");
  });
});

describe("short video", () => {
  it("wraps and cleans the text it draws, and keeps the caption honest", () => {
    assert.equal(stripEmoji("Corre 🏃‍♂️ que acaba 🔥!"), "Corre que acaba !");
    assert.deepEqual(wrapLines("Seu celular antigo já pode pedir aposentadoria", 20, 3), ["Seu celular antigo", "já pode pedir", "aposentadoria"]);
    const cut = wrapLines("um dois três quatro cinco seis sete oito nove dez", 10, 2);
    assert.equal(cut.length, 2);
    assert.match(cut[1]!, /…$/);
    const spec = { hook: "Seu setup agradece 🎮", title: "Mouse Gamer G203", marketplace: "shopee" as const, priceCents: 11990, originalPriceCents: 19990, discountPct: 40, brand: "Dev das Promos", imagePath: "/tmp/p.jpg" };
    const caption = socialCaption(spec, "Logitech");
    assert.match(caption, /R\$\s119,90 \(-40%\) na Shopee/);
    assert.match(caption, /Link na bio/);
    assert.match(caption, /#publi/);
    assert.match(caption, /#Logitech/);
    const dir = mkdtempSync(join(tmpdir(), "video-test-"));
    try {
      const filter = videoFilter(spec, dir, "/fonts/f.ttf");
      assert.match(filter, /expansion=none/, "a % in the text can't break ffmpeg");
      assert.match(filter, /zoompan=/);
      assert.ok(readdirSync(dir).length >= 8, "one text file per line drawn");
      assert.ok(!readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("").includes("🎮"), "emoji stripped");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("worker crons", () => {
  it("only uses cron strings Cloudflare accepts, and the Worker handles each of them", () => {
    const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    const crons = JSON.parse(toml.match(/^crons\s*=\s*(\[.*\])/m)![1]!) as string[];
    const days = /^(\*|([1-7]|SUN|MON|TUE|WED|THU|FRI|SAT)(-([1-7]|SUN|MON|TUE|WED|THU|FRI|SAT))?)(\/\d+)?$/i;
    for (const cron of crons) {
      const fields = cron.split(/\s+/);
      assert.equal(fields.length, 5, cron);
      for (const part of fields[4]!.split(",")) assert.match(part, days, `weekday must be 1-7 or SUN-SAT in "${cron}"`);
    }
    assert.ok(crons.includes(QUEUE_CRON), "queue cron is installed");
    assert.ok(crons.includes(ROUNDUP_CRON), "roundup cron is installed");
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
