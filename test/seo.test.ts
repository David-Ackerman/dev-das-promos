import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHandler } from "../src/http.ts";
import { MCP_VERSIONS, searchWords } from "../src/mcp.ts";
import { pingIndexNow, robotsTxt, sitemapXml } from "../src/seo.ts";
import { dealPage, dealPath, priceChart, slugify } from "../src/site.ts";
import type { DealDetail } from "../src/repo.ts";
import { mockFetch, testConfig } from "./helpers.ts";

const deal = (over: Partial<DealDetail> = {}): DealDetail => ({
  id: 42,
  product_id: 7,
  title: "Teclado Mecânico Redragon Kumara K552 – RGB, Switch Outemu Blue",
  marketplace: "shopee",
  image_url: "https://down-br.img.susercontent.com/file/abc",
  price_cents: 15990,
  original_price_cents: 24990,
  discount_pct: 36,
  caption: "Esse teclado vai melhorar sua gameplay",
  published: "27/10 às 14:00",
  published_iso: "2026-10-27T17:00:00Z",
  code: "abc1234",
  lowest_seen_cents: 16990,
  live: true,
  ended: false,
  ...over,
});
const HISTORY = [
  { day: "2026-09-01", price_cents: 21990 },
  { day: "2026-10-01", price_cents: 18990 },
  { day: "2026-10-27", price_cents: 15990 },
];

/** Answers the handful of queries the public routes make. */
function fakeDb(d: DealDetail | undefined, opts: { search?: DealDetail[] } = {}) {
  const calls: { text: string; params: unknown[] }[] = [];
  return {
    calls,
    db: {
      async query(text: string, params: unknown[] = []) {
        calls.push({ text, params });
        if (text.includes("WHERE p.id = $1")) return d ? [d] : [];
        if (text.includes("FROM price_snapshots")) return HISTORY;
        if (text.includes("ORDER BY (p.deal_ended_at IS NULL")) return opts.search ?? (d ? [d] : []);
        if (text.includes("GREATEST(p.published_at")) return d ? [{ id: d.id, title: d.title, lastmod: "2026-10-27T17:00:00Z" }] : [];
        return [];
      },
    } as never,
  };
}

const cfg = testConfig({ SITE_NAME: "Dev das Promos", SITE_TELEGRAM_URL: "https://t.me/+abc" });
const ctx = { waitUntil: () => {} };
const get = (handler: ReturnType<typeof createHandler>, path: string, init: RequestInit = {}) =>
  handler.fetch(new Request(`https://promo.example.workers.dev${path}`, { headers: { "user-agent": "Mozilla/5.0" }, ...init }), {}, ctx);

describe("deal pages", () => {
  it("makes short ASCII slugs", () => {
    assert.equal(slugify("Teclado Mecânico Redragon Kumara K552 – RGB"), "teclado-mecanico-redragon-kumara-k552-rgb");
    assert.equal(slugify("!!!"), "oferta");
    const long = slugify("Fone de Ouvido Bluetooth Sem Fio com Cancelamento de Ruído Ativo e Estojo de Carga Rápida");
    assert.ok(long.length <= 60 && !long.endsWith("-"), long);
    assert.equal(dealPath(5, "SSD 1TB"), "/oferta/5-ssd-1tb");
  });

  it("claims a price in structured data only while the deal is live", () => {
    const live = dealPage(cfg, deal(), HISTORY, []);
    assert.match(live, /"@type":"Offer"/);
    assert.match(live, /"price":"159.90","priceCurrency":"BRL"/);
    assert.match(live, /<link rel="canonical" href="https:\/\/promo\.example\.workers\.dev\/oferta\/42-teclado-mecanico/);
    assert.match(live, /Menor preço que registramos nos últimos 90 dias: R\$\s159,90/);
    assert.match(live, /href="https:\/\/promo\.example\.workers\.dev\/go\/abc1234" rel="nofollow sponsored noopener"/);
    const old = dealPage(cfg, deal({ live: false, ended: true }), HISTORY, []);
    assert.doesNotMatch(old, /"@type":"Offer"/);
    assert.match(old, /Oferta encerrada/);
  });

  it("a title can't break out of the JSON-LD script", () => {
    const html = dealPage(cfg, deal({ title: "Hack </script><script>alert(1)</script>" }), [], []);
    assert.ok(!html.includes("</script><script>alert(1)"), "escaped");
  });

  it("draws the chart only with 2+ days of history", () => {
    assert.equal(priceChart(HISTORY.slice(0, 1)), "");
    assert.match(priceChart(HISTORY), /^<svg class="chart"/);
  });

  it("serves the page, sends wrong slugs to the right URL, 404s unknown ids", async () => {
    const h = createHandler(() => ({ cfg, ...fakeDb(deal()) }));
    const ok = await get(h, "/oferta/42-teclado-mecanico-redragon-kumara-k552-rgb-switch-outemu-blue");
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /application\/ld\+json/);
    const moved = await get(h, "/oferta/42?src=x");
    assert.equal(moved.status, 301);
    assert.equal(moved.headers.get("location"), "/oferta/42-teclado-mecanico-redragon-kumara-k552-rgb-switch-outemu-blue?src=x");
    const missing = await get(createHandler(() => ({ cfg, ...fakeDb(undefined) })), "/oferta/9-x");
    assert.equal(missing.status, 404);
  });
});

describe("crawler files", () => {
  it("robots.txt welcomes AI assistants, hides redirects, points to the sitemap", () => {
    const r = robotsTxt(cfg);
    for (const ua of ["OAI-SearchBot", "Claude-SearchBot", "PerplexityBot"]) assert.match(r, new RegExp(`User-agent: ${ua}`));
    assert.match(r, /Disallow: \/go\//);
    assert.match(r, /Sitemap: https:\/\/promo\.example\.workers\.dev\/sitemap\.xml/);
  });

  it("sitemap lists home and deal pages, XML-escaped", () => {
    const x = sitemapXml(cfg, [{ id: 3, title: "Cabo USB & HDMI", lastmod: "2026-10-27T10:00:00Z" }]);
    assert.match(x, /<loc>https:\/\/promo\.example\.workers\.dev\/<\/loc>/);
    assert.match(x, /<loc>https:\/\/promo\.example\.workers\.dev\/oferta\/3-cabo-usb-hdmi<\/loc><lastmod>2026-10-27T10:00:00Z<\/lastmod>/);
  });

  it("serves sitemap, feed and llms.txt", async () => {
    const h = createHandler(() => ({ cfg, ...fakeDb(deal()) }));
    assert.match(await (await get(h, "/sitemap.xml")).text(), /oferta\/42-/);
    const feed = await (await get(h, "/feed.xml")).text();
    assert.match(feed, /<rss version="2.0"/);
    assert.match(feed, /\?src=rss/);
    const llms = await (await get(h, "/llms.txt")).text();
    assert.match(llms, /^# Dev das Promos/);
    assert.match(llms, /\/mcp\)/);
    assert.match(llms, /Teclado Mecânico .* por R\$\s159,90 \(antes R\$\s249,90, -36%\) na Shopee/);
  });

  it("pings IndexNow only with a key, and serves the key file", async () => {
    const f = mockFetch([["indexnow", () => new Response(null, { status: 202 })]]);
    try {
      await pingIndexNow(cfg, ["https://promo.example.workers.dev/oferta/1-x"]);
      assert.equal(f.calls.length, 0, "off without INDEXNOW_KEY");
      const keyed = testConfig({ INDEXNOW_KEY: "0123456789abcdef0123456789abcdef" });
      await pingIndexNow(keyed, ["https://promo.example.workers.dev/oferta/1-x"]);
      const body = f.to("api.indexnow.org")[0]!.body;
      assert.equal(body.host, "promo.example.workers.dev");
      assert.equal(body.keyLocation, "https://promo.example.workers.dev/0123456789abcdef0123456789abcdef.txt");
      const h = createHandler(() => ({ cfg: keyed, ...fakeDb(undefined) }));
      assert.equal(await (await get(h, "/0123456789abcdef0123456789abcdef.txt")).text(), "0123456789abcdef0123456789abcdef");
    } finally {
      f.restore();
    }
  });
});

describe("MCP server", () => {
  const rpc = async (h: ReturnType<typeof createHandler>, body: unknown) =>
    get(h, "/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });

  it("initializes, lists read-only tools, ignores notifications", async () => {
    const h = createHandler(() => ({ cfg, ...fakeDb(deal()) }));
    const init = (await (await rpc(h, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } })).json()) as any;
    assert.equal(init.result.protocolVersion, "2025-06-18");
    assert.ok(init.result.capabilities.tools);
    const unknown = (await (await rpc(h, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } })).json()) as any;
    assert.equal(unknown.result.protocolVersion, MCP_VERSIONS[0]);
    const note = await rpc(h, { jsonrpc: "2.0", method: "notifications/initialized" });
    assert.equal(note.status, 202);
    const list = (await (await rpc(h, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as any;
    assert.deepEqual(list.result.tools.map((t: { name: string }) => t.name), ["search_deals", "latest_deals", "get_deal", "community_links"]);
    assert.ok(list.result.tools.every((t: { annotations: { readOnlyHint: boolean } }) => t.annotations.readOnlyHint));
    const bad = (await (await rpc(h, { jsonrpc: "2.0", id: 3, method: "nope" })).json()) as any;
    assert.equal(bad.error.code, -32601);
  });

  it("searches with the words, price cap and store, and hands out tracked 'ai' links", async () => {
    const fake = fakeDb(deal());
    const h = createHandler(() => ({ cfg, ...fake }));
    const res = (await (await rpc(h, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search_deals", arguments: { query: "Teclado Mecânico", max_price_brl: 200, store: "shopee" } } })).json()) as any;
    const text = res.result.content[0].text as string;
    assert.match(text, /R\$\s159,90/);
    assert.match(text, /\/go\/abc1234/);
    assert.match(text, /#publi/);
    assert.equal(res.result.structuredContent.deals[0].status, "live");
    const q = fake.calls.find((c) => c.text.includes("ORDER BY (p.deal_ended_at IS NULL"))!;
    assert.deepEqual(q.params, [7, 5, "ai", 20000, "shopee", "%teclado%", "%mecanico%"]);
    const detail = (await (await rpc(h, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_deal", arguments: { id: 42 } } })).json()) as any;
    assert.match(detail.result.content[0].text, /Menor preço que registramos/);
    assert.equal(detail.result.structuredContent.price_history.length, 3);
  });

  it("splits search words like the SQL expects", () => {
    assert.deepEqual(searchWords("Fone  Bluetooth, à prova d'água"), ["fone", "bluetooth", "prova", "agua"]);
  });

  it("answers the JSON API and its OpenAPI description", async () => {
    const h = createHandler(() => ({ cfg, ...fakeDb(deal()) }));
    const api = await get(h, "/api/ofertas?q=teclado&preco_max=200");
    assert.equal(api.headers.get("access-control-allow-origin"), "*");
    const body = (await api.json()) as any;
    assert.equal(body.deals[0].price_brl, 159.9);
    assert.match(body.deals[0].page_url, /\/oferta\/42-/);
    const one = (await (await get(h, "/api/ofertas/42")).json()) as any;
    assert.equal(one.price_history.length, 3);
    const spec = (await (await get(h, "/openapi.json")).json()) as any;
    assert.equal(spec.servers[0].url, "https://promo.example.workers.dev");
    assert.ok(spec.paths["/api/ofertas"].get.operationId);
  });
});
