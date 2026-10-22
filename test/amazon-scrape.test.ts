import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  amazonAffiliateUrl,
  amazonSearchUrl,
  fetchAmazonScrapedCandidates,
  isAmazonBlockPage,
  largeAmazonImage,
  parseAmazonSearchHtml,
} from "../src/providers/amazon-scrape.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const SEARCH = fixture("amazon-search.html");
const SEARCH_2 = fixture("amazon-search-2.html");
const CAPTCHA = fixture("amazon-captcha.html");

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

describe("parseAmazonSearchHtml", () => {
  const items = parseAmazonSearchHtml(SEARCH);
  const byAsin = (asin: string) => items.find((i) => i.asin === asin);

  it("keeps only organic results with ASIN and price", () => {
    assert.deepEqual(
      items.map((i) => i.asin),
      ["B0ABCDE123", "B0NOLIST02", "B0BADGE004"],
    );
  });

  it("reads price, struck list price, discount, rating, reviews and a big image", () => {
    assert.deepEqual(byAsin("B0ABCDE123"), {
      asin: "B0ABCDE123",
      title: "Fone de Ouvido Bluetooth JBL Tune 520BT, Preto",
      priceCents: 129990,
      originalPriceCents: 199990,
      discountPct: 35,
      imageUrl: "https://m.media-amazon.com/images/I/71abcDEF12L._AC_SL1500_.jpg",
      rating: 4.6,
      reviewCount: 12345,
      sponsored: false,
    });
  });

  it("no list price: discount 0, unit price ignored, entities decoded, single quotes ok", () => {
    const item = byAsin("B0NOLIST02")!;
    assert.equal(item.title, 'Café-like "Pro" Fone & Microfone – Edição 2026');
    assert.equal(item.priceCents, 8990);
    assert.equal(item.originalPriceCents, undefined);
    assert.equal(item.discountPct, 0);
    assert.equal(item.rating, 4.2);
    assert.equal(item.reviewCount, 1200);
    assert.equal(item.imageUrl, "https://m.media-amazon.com/images/I/61xyz789._AC_SL1500_.jpg");
  });

  it("uses a -20% badge when no list price is shown", () => {
    const item = byAsin("B0BADGE004")!;
    assert.equal(item.discountPct, 20);
    assert.equal(item.originalPriceCents, 10000);
    assert.equal(item.rating, undefined);
  });

  it("sponsored results only on request, with the ad prefix dropped from the title", () => {
    const ad = parseAmazonSearchHtml(SEARCH, { includeSponsored: true }).find((i) => i.asin === "B0SPONS001");
    assert.equal(ad?.sponsored, true);
    assert.equal(ad?.title, "Fone Genérico");
    assert.equal(ad?.discountPct, 75);
  });

  it("nothing to read -> empty list", () => {
    assert.deepEqual(parseAmazonSearchHtml(""), []);
    assert.deepEqual(parseAmazonSearchHtml(CAPTCHA), []);
  });
});

describe("Amazon scrape helpers", () => {
  it("detects the captcha / robot page", () => {
    assert.equal(isAmazonBlockPage(CAPTCHA, 200), true);
    assert.equal(isAmazonBlockPage("<html></html>", 503), true);
    assert.equal(isAmazonBlockPage("<p>To discuss automated access to Amazon data please contact api-services-support@amazon.com</p>", 200), true);
    assert.equal(isAmazonBlockPage(SEARCH, 200), false);
  });

  it("builds the tagged /dp/ link and rejects bad ASINs", () => {
    assert.equal(amazonAffiliateUrl("b0abcde123", "meu-20"), "https://www.amazon.com.br/dp/B0ABCDE123?tag=meu-20");
    assert.throws(() => amazonAffiliateUrl("B0ABC", "meu-20"), /Invalid ASIN/);
    assert.throws(() => amazonAffiliateUrl("B0ABC/../x", "meu-20"), /Invalid ASIN/);
    assert.throws(() => amazonAffiliateUrl("B0ABCDE123", " "), /AMAZON_PARTNER_TAG/);
  });

  it("upgrades only Amazon image URLs", () => {
    assert.equal(
      largeAmazonImage("https://m.media-amazon.com/images/I/71abc._AC_UL320_.jpg"),
      "https://m.media-amazon.com/images/I/71abc._AC_SL1500_.jpg",
    );
    assert.equal(
      largeAmazonImage("https://m.media-amazon.com/images/I/71abc.__AC_SX300_SY300_QL70_ML2_.jpg"),
      "https://m.media-amazon.com/images/I/71abc._AC_SL1500_.jpg",
    );
    assert.equal(largeAmazonImage("https://example.com/a._AC_UL320_.jpg"), "https://example.com/a._AC_UL320_.jpg");
  });

  it("search URL", () => {
    assert.equal(amazonSearchUrl("fone bluetooth"), "https://www.amazon.com.br/s?k=fone+bluetooth");
    assert.equal(amazonSearchUrl("air fryer", 2), "https://www.amazon.com.br/s?k=air+fryer&page=2");
  });
});

describe("fetchAmazonScrapedCandidates", () => {
  function fakeFetch(pages: Record<string, () => Response>) {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, headers: init.headers as Record<string, string> });
      const k = new URL(url).searchParams.get("k") ?? "";
      const page = pages[k];
      return page ? page() : html("not found", 404);
    }) as typeof fetch;
    return { fn, calls };
  }
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };

  it("searches each query politely, dedupes by ASIN and maps to tagged candidates", async () => {
    const { fn, calls } = fakeFetch({ fone: () => html(SEARCH), "air fryer": () => html(SEARCH_2) });
    sleeps.length = 0;
    const found = await fetchAmazonScrapedCandidates(
      { partnerTag: "meu-20", queries: ["fone", "air fryer"], delayMs: 1000 },
      { fetch: fn, sleep },
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[0]!.url, "https://www.amazon.com.br/s?k=fone");
    assert.match(calls[0]!.headers["accept-language"]!, /^pt-BR/);
    assert.match(calls[0]!.headers["user-agent"]!, /Chrome\//);
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0]! >= 1000 && sleeps[0]! <= 2000);

    assert.deepEqual(
      found.map((c) => c.externalId),
      ["B0AIRFRY05", "B0ABCDE123", "B0BADGE004", "B0NOLIST02"],
    );
    const jbl = found.find((c) => c.externalId === "B0ABCDE123")!;
    assert.deepEqual(jbl, {
      marketplace: "amazon",
      externalId: "B0ABCDE123",
      title: "Fone de Ouvido Bluetooth JBL Tune 520BT, Preto",
      imageUrl: "https://m.media-amazon.com/images/I/71abcDEF12L._AC_SL1500_.jpg",
      productUrl: "https://www.amazon.com.br/dp/B0ABCDE123?tag=meu-20",
      priceCents: 129990,
      originalPriceCents: 199990,
      discountPct: 35,
      rating: 4.6,
    });
  });

  it("filters by minDiscountPct and reads up to maxPages", async () => {
    const { fn, calls } = fakeFetch({ fone: () => html(SEARCH) });
    const found = await fetchAmazonScrapedCandidates(
      { partnerTag: "meu-20", queries: ["fone"], minDiscountPct: 30, maxPages: 2, delayMs: 0 },
      { fetch: fn, sleep },
    );
    assert.deepEqual(found.map((c) => c.externalId), ["B0ABCDE123"]);
    assert.deepEqual(calls.map((c) => c.url), ["https://www.amazon.com.br/s?k=fone", "https://www.amazon.com.br/s?k=fone&page=2"]);
  });

  it("a captcha on the second query stops there and keeps what the first found", async () => {
    const { fn, calls } = fakeFetch({ fone: () => html(SEARCH), "air fryer": () => html(CAPTCHA), cafeteira: () => html(SEARCH_2) });
    const logs: string[] = [];
    const found = await fetchAmazonScrapedCandidates(
      { partnerTag: "meu-20", queries: ["fone", "air fryer", "cafeteira"], delayMs: 0 },
      { fetch: fn, sleep, log: (m) => logs.push(m) },
    );
    assert.equal(calls.length, 2, "no request after the captcha");
    assert.equal(found.length, 3);
    assert.ok(logs.some((l) => /captcha/.test(l)));
  });

  it("a captcha before anything was found throws a clear error", async () => {
    const { fn, calls } = fakeFetch({ fone: () => html(CAPTCHA), "air fryer": () => html(SEARCH_2) });
    await assert.rejects(
      fetchAmazonScrapedCandidates({ partnerTag: "meu-20", queries: ["fone", "air fryer"] }, { fetch: fn, sleep }),
      /Amazon bloqueou a busca \(captcha\)/,
    );
    assert.equal(calls.length, 1);
  });

  it("HTTP 503 counts as a block", async () => {
    const { fn } = fakeFetch({ fone: () => html("<html>Sorry</html>", 503) });
    await assert.rejects(
      fetchAmazonScrapedCandidates({ partnerTag: "meu-20", queries: ["fone"] }, { fetch: fn, sleep }),
      /captcha/,
    );
  });

  it("network errors on every request throw; an empty page does not", async () => {
    const failing = (async () => {
      throw new Error("timeout");
    }) as typeof fetch;
    await assert.rejects(
      fetchAmazonScrapedCandidates({ partnerTag: "meu-20", queries: ["fone"] }, { fetch: failing, sleep }),
      /timeout/,
    );
    const { fn } = fakeFetch({ fone: () => html("<html><body>Nenhum resultado</body></html>") });
    assert.deepEqual(await fetchAmazonScrapedCandidates({ partnerTag: "meu-20", queries: ["fone"] }, { fetch: fn, sleep }), []);
  });
});
