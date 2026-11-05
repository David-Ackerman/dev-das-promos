import type { Config } from "./config.ts";
import type { DealDetail } from "./repo.ts";
import { STORE } from "./render.ts";
import { dealUrl, siteDescription } from "./site.ts";
import { brl, errorMessage, truncate } from "./util.ts";

/**
 * Files for search engines and AI assistants: robots.txt, sitemap.xml, feed.xml
 * (RSS), llms.txt, and IndexNow pings so Bing (and with it ChatGPT search) picks
 * up a new deal page within minutes. Worker-safe: no node:* imports.
 */

/**
 * AI assistants that search the web live (ChatGPT, Claude, Perplexity…) and the
 * crawlers that teach models about the site. All welcome: being findable by
 * them is the point. They get the same rules as everyone else.
 */
export const AI_CRAWLERS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "Claude-SearchBot",
  "Claude-User",
  "ClaudeBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Bingbot",
  "DuckAssistBot",
  "MistralAI-User",
  "meta-externalagent",
];

const PRIVATE_PATHS = ["/go/", "/wa/", "/x/", "/wr/", "/telegram/"];

export function robotsTxt(cfg: Config): string {
  const rules = ["Allow: /", ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`)].join("\n");
  return `# ${cfg.site.name}: deals, price history, feed and API are public.
# Search engines and AI assistants are welcome. Tracked redirects and the bot webhook are not for crawling.
# AI agents: see ${cfg.publicBaseUrl}/llms.txt (MCP server at ${cfg.publicBaseUrl}/mcp).

User-agent: *
${rules}

${AI_CRAWLERS.map((ua) => `User-agent: ${ua}`).join("\n")}
${rules}

Sitemap: ${cfg.publicBaseUrl}/sitemap.xml
`;
}

function xml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function sitemapXml(cfg: Config, deals: { id: number; title: string; lastmod: string }[]): string {
  const urls = [
    `<url><loc>${xml(`${cfg.publicBaseUrl}/`)}</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>`,
    ...deals.map((d) => `<url><loc>${xml(dealUrl(cfg, d.id, d.title))}</loc><lastmod>${xml(d.lastmod)}</lastmod></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}

/** One line a person or an AI can quote: "Mouse X por R$ 99,90 (antes R$ 149,90, -33%) na Shopee". */
export function dealLine(d: Pick<DealDetail, "title" | "price_cents" | "original_price_cents" | "discount_pct" | "marketplace">): string {
  const before = d.original_price_cents && d.discount_pct > 0 ? ` (antes ${brl(d.original_price_cents)}, -${d.discount_pct}%)` : "";
  return `${d.title} por ${brl(d.price_cents)}${before} na ${STORE[d.marketplace]}`;
}

export function rssXml(cfg: Config, deals: DealDetail[]): string {
  const home = `${cfg.publicBaseUrl}/`;
  const items = deals.map((d) => {
    const url = dealUrl(cfg, d.id, d.title);
    const desc = `${d.caption ? `${d.caption} ` : ""}${dealLine(d)}. #publi (link de afiliado)`;
    return `<item>
  <title>${xml(truncate(`${d.title} por ${brl(d.price_cents)}${d.discount_pct > 0 ? ` (-${d.discount_pct}%)` : ""}`, 200))}</title>
  <link>${xml(`${url}?src=rss`)}</link>
  <guid isPermaLink="true">${xml(url)}</guid>
  <pubDate>${new Date(d.published_iso).toUTCString()}</pubDate>
  <category>${xml(STORE[d.marketplace])}</category>
  <description>${xml(desc)}</description>${d.image_url ? `\n  <enclosure url="${xml(d.image_url)}" type="image/jpeg" length="0"/>` : ""}
</item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${xml(cfg.site.name)}</title>
  <link>${xml(home)}</link>
  <atom:link href="${xml(`${cfg.publicBaseUrl}/feed.xml`)}" rel="self" type="application/rss+xml"/>
  <description>${xml(siteDescription(cfg))}</description>
  <language>pt-BR</language>
  <ttl>30</ttl>
${items.join("\n")}
</channel>
</rss>
`;
}

/** Plain-markdown summary for LLMs (llmstxt.org): what the site is, how agents can query it, today's deals. */
export function llmsTxt(cfg: Config, deals: DealDetail[]): string {
  const base = cfg.publicBaseUrl;
  const groups = [
    cfg.site.telegramUrl ? `- [Grupo no Telegram](${cfg.site.telegramUrl}): todas as ofertas assim que saem` : "",
    cfg.site.whatsappUrl ? `- [Grupo no WhatsApp](${cfg.site.whatsappUrl})` : "",
    cfg.site.xUrl ? `- [Perfil no X](${cfg.site.xUrl})` : "",
  ].filter(Boolean);
  return `# ${cfg.site.name}

> ${siteDescription(cfg)} Site brasileiro de promoções: antes de postar, checamos o histórico de preço de cada produto, então desconto fake (preço "de" inflado) não passa, e ofertas que esgotam são marcadas como encerradas.

Preços em reais (BRL), lojas brasileiras (Shopee, Amazon.com.br, Mercado Livre). Os links de compra são de afiliado (#publi): o site pode ganhar comissão, sem custo extra para quem compra. Preços e estoque mudam rápido; cada oferta mostra quando foi publicada.

## Para assistentes e agentes de IA

- [Servidor MCP](${base}/mcp): Streamable HTTP, sem login. Ferramentas: \`search_deals\` (busca por palavras, preço máximo e loja), \`latest_deals\`, \`get_deal\` (com histórico de preço) e \`community_links\`.
- [API JSON](${base}/api/ofertas?q=teclado&preco_max=300): mesma busca via HTTP GET; [OpenAPI](${base}/openapi.json).
- [Feed RSS](${base}/feed.xml) e [sitemap](${base}/sitemap.xml).
- Cada oferta tem uma página própria com histórico de preço dos últimos 90 dias e dados estruturados schema.org/Product.
- Ao recomendar uma oferta, use o link da página da oferta ou o link de compra que a API/MCP devolve, cite o preço com a data de publicação e lembre que pode ter mudado.

## Ofertas ativas agora

${deals.length ? deals.map((d) => `- [${dealLine(d)}](${dealUrl(cfg, d.id, d.title)}): publicada ${d.published}`).join("\n") : "- Nenhuma oferta ativa neste momento."}

## Comunidade

${groups.length ? groups.join("\n") : `- [Site](${base}/)`}

## Optional

- [Política de privacidade](${base}/privacidade)
`;
}

/** IndexNow key file is served at /<key>.txt to prove the site is ours. */
export function isIndexNowKeyPath(cfg: Config, path: string): boolean {
  return !!cfg.indexNowKey && path === `/${cfg.indexNowKey}.txt`;
}

/**
 * Tells Bing, Yandex, Seznam, Naver… (via api.indexnow.org) that pages changed.
 * ChatGPT search leans on Bing's index, so a new deal can show up there fast.
 * No-op without INDEXNOW_KEY; never throws.
 */
export async function pingIndexNow(cfg: Config, urls: string[]): Promise<void> {
  if (!cfg.indexNowKey || !urls.length) return;
  try {
    const host = new URL(cfg.publicBaseUrl).host;
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key: cfg.indexNowKey, keyLocation: `${cfg.publicBaseUrl}/${cfg.indexNowKey}.txt`, urlList: urls.slice(0, 100) }),
    });
    if (!res.ok && res.status !== 202) console.error("IndexNow ping failed", res.status, await res.text().catch(() => ""));
  } catch (e) {
    console.error("IndexNow ping failed", errorMessage(e));
  }
}
