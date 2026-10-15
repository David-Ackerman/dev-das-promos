import type { Config } from "./config.ts";
import { STORE } from "./render.ts";
import type { Marketplace } from "./types.ts";
import { brl, escapeHtml, truncate } from "./util.ts";

/**
 * Public deals page (GET / and /ofertas): what was published in the last days,
 * each with its own /go link (channel "web"), so search engines and shared
 * links bring people in and /stats counts them. Server-rendered, no scripts.
 */
export interface SiteDeal {
  id: number;
  title: string;
  marketplace: Marketplace;
  image_url: string | null;
  price_cents: number;
  original_price_cents: number | null;
  discount_pct: number;
  caption: string;
  published: string;
  code: string;
}

function attr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

function card(cfg: Config, d: SiteDeal): string {
  const href = `${cfg.publicBaseUrl}/go/${d.code}`;
  const old =
    d.original_price_cents && d.discount_pct > 0 ? `<s>${brl(d.original_price_cents)}</s> ` : "";
  return `<article class="deal">
  ${d.image_url ? `<img src="${attr(d.image_url)}" alt="" loading="lazy" width="320" height="320">` : `<div class="noimg">🛍️</div>`}
  <div class="body">
    <div class="tags"><span>${STORE[d.marketplace]}</span>${d.discount_pct > 0 ? `<span class="off">-${d.discount_pct}%</span>` : ""}</div>
    <h2>${escapeHtml(truncate(d.title, 110))}</h2>
    <p class="joke">${escapeHtml(d.caption)}</p>
    <p class="price">${old}<b>${brl(d.price_cents)}</b></p>
    <a class="go" href="${attr(href)}" rel="nofollow sponsored noopener" target="_blank">Ver oferta</a>
    <p class="when">Publicado ${escapeHtml(d.published)}</p>
  </div>
</article>`;
}

export function sitePage(cfg: Config, deals: SiteDeal[]): string {
  const name = cfg.site.name;
  const description = cfg.ai.niche
    ? `Promoções de ${cfg.ai.niche}, escolhidas a dedo na Shopee, Amazon e Mercado Livre.`
    : "Promoções escolhidas a dedo na Shopee, Amazon e Mercado Livre.";
  const join = [
    cfg.site.telegramUrl ? `<a class="join" href="${attr(cfg.site.telegramUrl)}" rel="noopener">Entrar no grupo do Telegram</a>` : "",
    cfg.site.whatsappUrl ? `<a class="join wa" href="${attr(cfg.site.whatsappUrl)}" rel="noopener">Entrar no WhatsApp</a>` : "",
  ].join("");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)} · Promoções de hoje</title>
<meta name="description" content="${attr(description)}">
<link rel="canonical" href="${attr(cfg.publicBaseUrl)}/">
<meta property="og:title" content="${attr(name)}">
<meta property="og:description" content="${attr(description)}">
<meta property="og:type" content="website">
${deals[0]?.image_url ? `<meta property="og:image" content="${attr(deals[0].image_url)}">` : ""}
<style>
  :root { color-scheme: light dark; --bg: #f6f7f9; --card: #fff; --fg: #14171a; --muted: #5b6672; --line: #e3e7ec; --accent: #e8590c; --accent-fg: #fff; --ok: #2b8a3e; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0e1013; --card: #171a1f; --fg: #e9edf1; --muted: #98a2ad; --line: #262b33; --accent: #ff7a33; --accent-fg: #111; --ok: #51cf66; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  header, main, footer { max-width: 1080px; margin: 0 auto; padding: 0 16px; }
  header { padding-top: 28px; padding-bottom: 8px; }
  h1 { margin: 0; font-size: 28px; }
  header p { margin: 6px 0 14px; color: var(--muted); }
  .join { display: inline-block; margin: 0 8px 8px 0; padding: 10px 16px; border-radius: 999px; background: #229ed9; color: #fff; font-weight: 700; text-decoration: none; }
  .join.wa { background: #25d366; color: #0b2e17; }
  main { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); padding-top: 16px; padding-bottom: 24px; }
  .deal { display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .deal img, .noimg { width: 100%; aspect-ratio: 1; max-height: 240px; object-fit: contain; background: #fff; }
  .noimg { display: grid; place-items: center; font-size: 48px; background: var(--line); }
  .body { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px 14px; flex: 1; }
  .tags { display: flex; gap: 6px; font-size: 12px; font-weight: 700; }
  .tags span { padding: 2px 8px; border-radius: 999px; background: var(--line); }
  .tags .off { background: var(--ok); color: #fff; }
  h2 { margin: 0; font-size: 15px; line-height: 1.3; }
  .joke { margin: 0; color: var(--muted); font-size: 14px; }
  .price { margin: auto 0 0; font-size: 18px; }
  .price s { color: var(--muted); font-size: 14px; }
  .go { display: block; padding: 10px; border-radius: 10px; background: var(--accent); color: var(--accent-fg); font-weight: 700; text-align: center; text-decoration: none; }
  .when { margin: 0; color: var(--muted); font-size: 12px; }
  .empty { grid-column: 1 / -1; color: var(--muted); }
  footer { padding-bottom: 32px; color: var(--muted); font-size: 13px; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(name)}</h1>
  <p>${escapeHtml(description)}</p>
  ${join}
</header>
<main>
${deals.length ? deals.map((d) => card(cfg, d)).join("\n") : `<p class="empty">Nenhuma promoção ativa agora. Volte daqui a pouco!</p>`}
</main>
<footer>
  <p>#publi · Os links são de afiliado: podemos ganhar uma comissão quando você compra, sem custo a mais para você.
  Preços e estoque podem mudar a qualquer momento; confira na loja antes de comprar.</p>
</footer>
</body>
</html>`;
}

export const ROBOTS_TXT = `User-agent: *
Allow: /
Disallow: /go/
Disallow: /wa/
Disallow: /x/
Disallow: /telegram/
`;
