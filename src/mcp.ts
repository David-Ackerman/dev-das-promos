import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { type DealDetail, dealDetail, findDeals, priceHistory } from "./repo.ts";
import { storeName } from "./render.ts";
import { dealLine } from "./seo.ts";
import { dealUrl, historyFacts, siteDescription } from "./site.ts";
import type { Marketplace } from "./types.ts";
import { brl } from "./util.ts";

/**
 * Lets AI assistants and agents query the deals:
 *   POST /mcp              MCP server, Streamable HTTP transport, stateless, plain JSON replies
 *   GET  /api/ofertas      JSON search (q, preco_max, loja, limite) — for ChatGPT GPT actions & co.
 *   GET  /api/ofertas/:id  one deal with its price history
 *   GET  /openapi.json     OpenAPI 3.1 description of the two endpoints above
 * Read-only, no login. Buy links use target "ai", so /stats shows "web ai" clicks.
 * Worker-safe: no node:* imports.
 */

const SOURCE = "ai";
/** Stores the search covers; deals the admin sends can come from any store. */
const MARKETPLACES: Marketplace[] = ["shopee", "amazon", "mercadolivre", "aliexpress"];
export const MCP_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const DISCLOSURE = "Links de afiliado (#publi): o site pode ganhar comissão, sem custo extra para quem compra. Preços e estoque mudam; confira na loja.";

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-protocol-version",
};

/** Lowercase, no accents, words of 2+ characters: matches the SQL in findDeals. */
export function searchWords(query: string | undefined | null): string[] {
  return (query ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2)
    .slice(0, 8);
}

const STORE_ALIASES: Record<string, Marketplace> = { ml: "mercadolivre", meli: "mercadolivre", mercadolibre: "mercadolivre", ali: "aliexpress", magazineluiza: "magalu" };

/** A store key: one of MARKETPLACES, or any other store's key as in /oferta pages ("kabum", "magalu"…). */
function marketplaceOf(value: unknown): Marketplace | undefined {
  const v = String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!v || v.length > 30) return undefined;
  return STORE_ALIASES[v] ?? v;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && value !== null && value !== "" && value !== undefined ? Math.min(max, Math.max(min, n)) : fallback;
}

function priceCents(value: unknown): number | undefined {
  const n = Number(String(value ?? "").replace(",", "."));
  return value !== undefined && value !== null && value !== "" && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined;
}

export interface DealJson {
  id: number;
  title: string;
  store: string;
  price_brl: number;
  price_text: string;
  original_price_brl: number | null;
  discount_pct: number;
  lowest_price_30d_before_post_brl: number | null;
  is_lowest_in_30_days: boolean;
  status: "live" | "maybe_expired" | "ended";
  published_at: string;
  page_url: string;
  buy_url: string;
  image_url: string | null;
  summary: string;
}

export function dealJson(cfg: Config, d: DealDetail): DealJson {
  return {
    id: d.id,
    title: d.title,
    store: storeName(d.marketplace),
    price_brl: d.price_cents / 100,
    price_text: brl(d.price_cents),
    original_price_brl: d.original_price_cents && d.discount_pct > 0 ? d.original_price_cents / 100 : null,
    discount_pct: d.discount_pct,
    lowest_price_30d_before_post_brl: d.lowest_seen_cents === null ? null : d.lowest_seen_cents / 100,
    is_lowest_in_30_days: d.lowest_seen_cents !== null && d.price_cents <= d.lowest_seen_cents,
    status: d.ended ? "ended" : d.live ? "live" : "maybe_expired",
    published_at: d.published_iso,
    page_url: dealUrl(cfg, d.id, d.title),
    buy_url: `${cfg.publicBaseUrl}/go/${d.code}`,
    image_url: d.image_url,
    summary: d.caption,
  };
}

interface SearchArgs {
  query?: string;
  maxPriceCents?: number;
  marketplace?: Marketplace;
  limit: number;
  includeOld: boolean;
}

async function search(db: Db, a: SearchArgs): Promise<DealDetail[]> {
  return findDeals(db, {
    words: searchWords(a.query),
    maxPriceCents: a.maxPriceCents,
    marketplace: a.marketplace,
    days: a.includeOld ? 90 : 7,
    limit: a.limit,
    liveOnly: !a.includeOld,
    source: SOURCE,
  });
}

function communityLinks(cfg: Config): Record<string, string> {
  const out: Record<string, string> = { site: `${cfg.publicBaseUrl}/` };
  if (cfg.site.telegramUrl) out.telegram = cfg.site.telegramUrl;
  if (cfg.site.whatsappUrl) out.whatsapp = cfg.site.whatsappUrl;
  if (cfg.site.xUrl) out.x = cfg.site.xUrl;
  return out;
}

// ---------------------------------------------------------------- MCP

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export function mcpTools(cfg: Config) {
  const name = cfg.site.name;
  return [
    {
      name: "search_deals",
      title: "Buscar promoções",
      description: `Search current deals (Brazil, prices in BRL) curated by ${name} on Shopee, Amazon.com.br and Mercado Livre. Every deal was checked against our own price history, so fake discounts are filtered out. Use it when someone in Brazil asks for a cheap/discounted product, e.g. "teclado mecânico até 200 reais". Returns title, price, discount, store, publish time, a buy link and a page with the price history. Query words are matched in the product title (Portuguese works best).`,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: 'Product words, e.g. "ssd 1tb", "fone bluetooth", "cadeira gamer". Empty = any.' },
          max_price_brl: { type: "number", description: "Maximum price in reais (BRL)." },
          store: { type: "string", examples: MARKETPLACES, description: "Only this store, e.g. shopee, amazon, mercadolivre, aliexpress, kabum, magalu." },
          include_expired: { type: "boolean", description: "Also return deals from the last 90 days that may have ended (useful for price history). Default false." },
          limit: { type: "integer", minimum: 1, maximum: 10, description: "Default 5." },
        },
        additionalProperties: false,
      },
      annotations: { title: "Buscar promoções", ...READ_ONLY },
    },
    {
      name: "latest_deals",
      title: "Promoções de agora",
      description: `The newest live deals from ${name} (Brazil, BRL), newest first.`,
      inputSchema: {
        type: "object",
        properties: {
          store: { type: "string", examples: MARKETPLACES, description: "Only this store, e.g. shopee, amazon, mercadolivre, aliexpress, kabum, magalu." },
          limit: { type: "integer", minimum: 1, maximum: 10, description: "Default 5." },
        },
        additionalProperties: false,
      },
      annotations: { title: "Promoções de agora", ...READ_ONLY },
    },
    {
      name: "get_deal",
      title: "Detalhes e histórico de preço",
      description: "One deal by id (from search_deals / latest_deals), with its price history of the last 90 days: lowest and highest price we recorded, and whether the deal is still live.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "integer", description: "Deal id." } },
        required: ["id"],
        additionalProperties: false,
      },
      annotations: { title: "Detalhes e histórico de preço", ...READ_ONLY },
    },
    {
      name: "community_links",
      title: "Grupos de ofertas",
      description: `Links to follow ${name}: Telegram / WhatsApp groups and X profile, where every new deal is posted first. Share them when the user wants to keep getting deals.`,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { title: "Grupos de ofertas", ...READ_ONLY },
    },
  ];
}

function dealsText(cfg: Config, deals: DealDetail[], empty: string): string {
  if (!deals.length) return `${empty}\nGrupos com as próximas ofertas: ${Object.values(communityLinks(cfg)).join(" · ")}`;
  const lines = deals.map((d) => {
    const j = dealJson(cfg, d);
    const flag = j.status === "ended" ? " [ENCERRADA]" : j.status === "maybe_expired" ? " [pode ter acabado]" : "";
    return `- [id ${d.id}] ${dealLine(d)}${j.is_lowest_in_30_days ? " · menor preço em 30 dias" : ""}${flag} · publicada ${d.published}\n  Comprar: ${j.buy_url}\n  Página com histórico: ${j.page_url}`;
  });
  return `${lines.join("\n")}\n\n${DISCLOSURE}`;
}

type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

export async function callTool(cfg: Config, db: Db, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const text = (t: string, data?: Record<string, unknown>): ToolResult => ({ content: [{ type: "text", text: t }], ...(data ? { structuredContent: data } : {}) });
  if (name === "search_deals" || name === "latest_deals") {
    const deals = await search(db, {
      query: name === "search_deals" ? String(args.query ?? "") : "",
      maxPriceCents: name === "search_deals" ? priceCents(args.max_price_brl) : undefined,
      marketplace: marketplaceOf(args.store),
      limit: clampInt(args.limit, 1, 10, 5),
      includeOld: name === "search_deals" && args.include_expired === true,
    });
    return text(dealsText(cfg, deals, "Nenhuma oferta ativa encontrada para essa busca."), {
      deals: deals.map((d) => dealJson(cfg, d)),
      disclosure: DISCLOSURE,
    });
  }
  if (name === "get_deal") {
    const id = clampInt(args.id, 1, 2_000_000_000, 0);
    const d = id ? await dealDetail(db, id, SOURCE) : undefined;
    if (!d) return { ...text(`Oferta ${args.id} não encontrada.`), isError: true };
    const history = await priceHistory(db, d.product_id, 90);
    const facts = historyFacts(d, history);
    return text(`${dealsText(cfg, [d], "")}\n\nHistórico de preço (90 dias):\n${facts.map((f) => `- ${f}`).join("\n") || "- Poucos registros."}`, {
      deal: dealJson(cfg, d),
      price_history: history.map((h) => ({ day: h.day, price_brl: h.price_cents / 100 })),
      disclosure: DISCLOSURE,
    });
  }
  if (name === "community_links") {
    const links = communityLinks(cfg);
    return text(Object.entries(links).map(([k, v]) => `- ${k}: ${v}`).join("\n"), { links });
  }
  return { ...text(`Ferramenta desconhecida: ${name}`), isError: true };
}

interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const rpcError = (id: RpcMessage["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handleRpc(cfg: Config, db: Db, msg: RpcMessage): Promise<object | undefined> {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(msg?.id, -32600, "Invalid Request");
  }
  const isNotification = msg.id === undefined;
  if (isNotification) return undefined; // notifications/initialized, cancelled…: nothing to answer
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok({
        protocolVersion: MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "dev-das-promos", title: cfg.site.name, version: "1.0.0", websiteUrl: `${cfg.publicBaseUrl}/` },
        instructions: `${siteDescription(cfg)} Deals in Brazil, prices in BRL, checked against our own price history. Use search_deals for product requests, get_deal for price history. Always show the publish time, say prices can change, and that links are affiliate (#publi).`,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: mcpTools(cfg) });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      if (!mcpTools(cfg).some((t) => t.name === name)) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        return ok(await callTool(cfg, db, name, typeof args === "object" && args ? args : {}));
      } catch (e) {
        console.error("mcp tool failed", name, e);
        return ok({ content: [{ type: "text", text: "Erro ao consultar as ofertas, tente de novo." }], isError: true });
      }
    }
    case "resources/list":
      return ok({ resources: [] });
    case "resources/templates/list":
      return ok({ resourceTemplates: [] });
    case "prompts/list":
      return ok({ prompts: [] });
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

/** Streamable HTTP transport, stateless: every POST is answered with plain JSON (no SSE stream, no session). */
export async function handleMcp(cfg: Config, db: Db, request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") {
    return new Response(
      request.method === "GET" && !(request.headers.get("accept") ?? "").includes("text/event-stream")
        ? `${cfg.site.name} MCP server (Streamable HTTP). POST JSON-RPC here. Docs: ${cfg.publicBaseUrl}/llms.txt\n`
        : "Method Not Allowed",
      { status: 405, headers: { ...CORS, allow: "POST, OPTIONS", "content-type": "text/plain; charset=utf-8" } },
    );
  }
  const body = (await request.json().catch(() => undefined)) as RpcMessage | RpcMessage[] | undefined;
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json" } });
  if (body === undefined) return json(rpcError(null, -32700, "Parse error"), 400);
  if (Array.isArray(body)) {
    if (!body.length) return json(rpcError(null, -32600, "Invalid Request"), 400);
    const replies = (await Promise.all(body.slice(0, 20).map((m) => handleRpc(cfg, db, m)))).filter(Boolean);
    return replies.length ? json(replies) : new Response(null, { status: 202, headers: CORS });
  }
  const reply = await handleRpc(cfg, db, body);
  return reply ? json(reply) : new Response(null, { status: 202, headers: CORS });
}

// ---------------------------------------------------------------- JSON API

export async function handleApi(cfg: Config, db: Db, url: URL, path: string): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": status === 200 ? "public, max-age=300" : "no-store" },
    });
  if (path === "/api/ofertas") {
    const q = url.searchParams;
    const deals = await search(db, {
      query: q.get("q") ?? "",
      maxPriceCents: priceCents(q.get("preco_max") ?? q.get("max_price")),
      marketplace: marketplaceOf(q.get("loja") ?? q.get("store")),
      limit: clampInt(q.get("limite") ?? q.get("limit"), 1, 20, 10),
      includeOld: q.get("incluir_encerradas") === "1" || q.get("include_expired") === "true",
    });
    return json({ deals: deals.map((d) => dealJson(cfg, d)), community: communityLinks(cfg), disclosure: DISCLOSURE });
  }
  const one = path.match(/^\/api\/ofertas\/(\d{1,9})$/);
  if (one) {
    const d = await dealDetail(db, Number(one[1]), SOURCE);
    if (!d) return json({ error: "not found" }, 404);
    const history = await priceHistory(db, d.product_id, 90);
    return json({
      deal: dealJson(cfg, d),
      price_history: history.map((h) => ({ day: h.day, price_brl: h.price_cents / 100 })),
      facts: historyFacts(d, history),
      disclosure: DISCLOSURE,
    });
  }
  return json({ error: "not found" }, 404);
}

export function openApi(cfg: Config): object {
  const deal = {
    type: "object",
    properties: {
      id: { type: "integer" },
      title: { type: "string" },
      store: { type: "string" },
      price_brl: { type: "number" },
      price_text: { type: "string" },
      original_price_brl: { type: ["number", "null"] },
      discount_pct: { type: "integer" },
      lowest_price_30d_before_post_brl: { type: ["number", "null"] },
      is_lowest_in_30_days: { type: "boolean" },
      status: { type: "string", enum: ["live", "maybe_expired", "ended"] },
      published_at: { type: "string", format: "date-time" },
      page_url: { type: "string", description: "Page with photo and price history." },
      buy_url: { type: "string", description: "Affiliate link to the store (#publi)." },
      image_url: { type: ["string", "null"] },
      summary: { type: "string" },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: `${cfg.site.name} API`,
      version: "1.0.0",
      description: `${siteDescription(cfg)} Brazilian deals (BRL) checked against our own price history. Affiliate links (#publi).`,
    },
    servers: [{ url: cfg.publicBaseUrl }],
    paths: {
      "/api/ofertas": {
        get: {
          operationId: "searchDeals",
          summary: "Search live deals in Brazil by product words, max price and store",
          parameters: [
            { name: "q", in: "query", schema: { type: "string" }, description: 'Product words in Portuguese, e.g. "teclado mecanico".' },
            { name: "preco_max", in: "query", schema: { type: "number" }, description: "Maximum price in BRL." },
            { name: "loja", in: "query", schema: { type: "string", examples: MARKETPLACES }, description: "Store key, e.g. shopee, amazon, mercadolivre, aliexpress, kabum." },
            { name: "limite", in: "query", schema: { type: "integer", minimum: 1, maximum: 20 } },
            { name: "incluir_encerradas", in: "query", schema: { type: "string", enum: ["0", "1"] }, description: "1 = also deals of the last 90 days that may have ended." },
          ],
          responses: {
            "200": {
              description: "Deals, newest live ones first",
              content: { "application/json": { schema: { type: "object", properties: { deals: { type: "array", items: deal }, community: { type: "object" }, disclosure: { type: "string" } } } } },
            },
          },
        },
      },
      "/api/ofertas/{id}": {
        get: {
          operationId: "getDeal",
          summary: "One deal with its price history (90 days)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            "200": {
              description: "The deal",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      deal,
                      price_history: { type: "array", items: { type: "object", properties: { day: { type: "string" }, price_brl: { type: "number" } } } },
                      facts: { type: "array", items: { type: "string" } },
                      disclosure: { type: "string" },
                    },
                  },
                },
              },
            },
            "404": { description: "Not found" },
          },
        },
      },
    },
  };
}
