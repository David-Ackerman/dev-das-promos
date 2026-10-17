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
  lowest_seen_cents: number | null;
}

/** Where a visit came from: ?src= on bio/share links, allow-listed so junk can't create rows. */
export const SITE_SOURCES = ["x", "ig", "tt", "yt", "tg", "wa", "share", "google"] as const;

export function siteSource(param: string | null, referer: string | null): string {
  const src = param?.trim().toLowerCase();
  if (src) return (SITE_SOURCES as readonly string[]).includes(src) ? src : "other";
  return referer && /(^|\.)google\./.test(safeHost(referer)) ? "google" : "";
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// Brand glyphs from Simple Icons (CC0), 24×24; the cart is Lucide (ISC).
const ICONS = {
  telegram:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>',
  whatsapp:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>',
  cart: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>',
};

function attr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

/** "Send to a friend" links point to the site (?src=share), never to the affiliate link. */
function shareLinks(cfg: Config, d: SiteDeal): string {
  const page = `${cfg.publicBaseUrl}/?src=share#oferta-${d.id}`;
  const text = `Olha essa oferta: ${truncate(d.title, 80)} por ${brl(d.price_cents)}`;
  const wa = `https://wa.me/?text=${encodeURIComponent(`${text} 👉 ${page}`)}`;
  const tg = `https://t.me/share/url?url=${encodeURIComponent(page)}&text=${encodeURIComponent(text)}`;
  return `<p class="share">Enviar pra um amigo:
      <a href="${attr(wa)}" rel="noopener" target="_blank" aria-label="Enviar no WhatsApp">${ICONS.whatsapp}</a>
      <a href="${attr(tg)}" rel="noopener" target="_blank" aria-label="Enviar no Telegram">${ICONS.telegram}</a></p>`;
}

function card(cfg: Config, d: SiteDeal): string {
  const href = `${cfg.publicBaseUrl}/go/${d.code}`;
  const old =
    d.original_price_cents && d.discount_pct > 0 ? `<s>${brl(d.original_price_cents)}</s> ` : "";
  // Only when our own 30-day history backs it up; never "menor preço do Brasil".
  const lowest = d.lowest_seen_cents !== null && d.price_cents <= d.lowest_seen_cents;
  return `<article class="deal" id="oferta-${d.id}">
  ${d.image_url ? `<img src="${attr(d.image_url)}" alt="" loading="lazy" width="320" height="320">` : `<div class="noimg">🛍️</div>`}
  <div class="body">
    <div class="tags"><span>${STORE[d.marketplace]}</span>${d.discount_pct > 0 ? `<span class="off">-${d.discount_pct}%</span>` : ""}${lowest ? `<span class="low">📉 Menor preço em 30 dias</span>` : ""}</div>
    <h2>${escapeHtml(truncate(d.title, 110))}</h2>
    <p class="joke">${escapeHtml(d.caption)}</p>
    <p class="price">${old}<b>${brl(d.price_cents)}</b></p>
    <a class="go" href="${attr(href)}" rel="nofollow sponsored noopener" target="_blank">${ICONS.cart}Ver oferta</a>
    ${shareLinks(cfg, d)}
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
    cfg.site.telegramUrl ? `<a class="join tg" href="${attr(cfg.site.telegramUrl)}" rel="noopener">${ICONS.telegram}Grupo no Telegram</a>` : "",
    cfg.site.whatsappUrl ? `<a class="join wa" href="${attr(cfg.site.whatsappUrl)}" rel="noopener">${ICONS.whatsapp}Grupo no WhatsApp</a>` : "",
    cfg.site.xUrl ? `<a class="join x" href="${attr(cfg.site.xUrl)}" rel="noopener">${ICONS.x}Seguir no X</a>` : "",
  ].join("");
  // Phones: the join buttons stay at the bottom of the screen while scrolling.
  const sticky = [
    cfg.site.telegramUrl ? `<a class="join tg" href="${attr(cfg.site.telegramUrl)}" rel="noopener">${ICONS.telegram}Entrar no Telegram</a>` : "",
    cfg.site.whatsappUrl ? `<a class="join wa" href="${attr(cfg.site.whatsappUrl)}" rel="noopener">${ICONS.whatsapp}WhatsApp</a>` : "",
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
<meta property="og:image" content="${attr(cfg.publicBaseUrl)}/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="556">
<meta name="twitter:card" content="summary_large_image">
<style>
  :root { color-scheme: light dark; --bg: #f6f7f9; --card: #fff; --fg: #14171a; --muted: #5b6672; --line: #e3e7ec; --accent: #e8590c; --accent-fg: #fff; --ok: #2b8a3e; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0e1013; --card: #171a1f; --fg: #e9edf1; --muted: #98a2ad; --line: #262b33; --accent: #ff7a33; --accent-fg: #111; --ok: #51cf66; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  header, main, footer { max-width: 1080px; margin: 0 auto; padding: 0 16px; }
  header { padding-top: 16px; padding-bottom: 8px; }
  /* The banner's left third is empty (made for an X header): crop toward the logo, more on phones. */
  .banner { display: block; width: 100%; height: auto; aspect-ratio: 2000 / 667; object-fit: cover; object-position: 75% center; border-radius: 16px; background: #0b1b3d; }
  @media (max-width: 640px) { .banner { aspect-ratio: 2 / 1; object-position: 80% center; border-radius: 12px; } }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  header p { margin: 12px 0 14px; color: var(--muted); }
  .links { display: flex; flex-wrap: wrap; gap: 8px; }
  .join { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 999px; font-weight: 700; text-decoration: none; }
  .join svg { width: 18px; height: 18px; flex: none; }
  .join.tg { background: #229ed9; color: #fff; }
  .join.wa { background: #25d366; color: #0b2e17; }
  .join.x { background: var(--fg); color: var(--bg); }
  main { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); padding-top: 16px; padding-bottom: 24px; }
  .deal { display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .deal img, .noimg { width: 100%; aspect-ratio: 1; max-height: 240px; object-fit: contain; background: #fff; }
  .noimg { display: grid; place-items: center; font-size: 48px; background: var(--line); }
  .body { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px 14px; flex: 1; }
  .tags { display: flex; gap: 6px; font-size: 12px; font-weight: 700; }
  .tags span { padding: 2px 8px; border-radius: 999px; background: var(--line); }
  .tags .off { background: var(--ok); color: #fff; }
  .tags .low { background: #1971c2; color: #fff; }
  .trust { margin: 0 0 14px; font-size: 14px; }
  .share { display: flex; align-items: center; gap: 10px; margin: 0; color: var(--muted); font-size: 12px; }
  .share a { display: inline-flex; color: var(--muted); }
  .share svg { width: 18px; height: 18px; }
  .sticky { display: none; }
  @media (max-width: 640px) {
    body.has-sticky { padding-bottom: 72px; }
    .sticky { display: flex; gap: 8px; justify-content: center; position: fixed; left: 0; right: 0; bottom: 0; padding: 10px 16px calc(10px + env(safe-area-inset-bottom)); background: var(--card); border-top: 1px solid var(--line); z-index: 10; }
    .sticky .join { flex: 1; justify-content: center; padding: 10px 12px; white-space: nowrap; font-size: 15px; }
    .sticky .join + .join { flex: 0 1 auto; }
  }
  h2 { margin: 0; font-size: 15px; line-height: 1.3; }
  .joke { margin: 0; color: var(--muted); font-size: 14px; }
  .price { margin: auto 0 0; font-size: 18px; }
  .price s { color: var(--muted); font-size: 14px; }
  .go { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; border-radius: 10px; background: var(--accent); color: var(--accent-fg); font-weight: 700; text-decoration: none; }
  .go svg { width: 18px; height: 18px; }
  .when { margin: 0; color: var(--muted); font-size: 12px; }
  .empty { grid-column: 1 / -1; color: var(--muted); }
  footer { padding-bottom: 32px; color: var(--muted); font-size: 13px; }
</style>
</head>
<body${sticky ? ' class="has-sticky"' : ""}>
<header>
  <h1 class="sr-only">${escapeHtml(name)}</h1>
  <img class="banner" src="/banner.webp" srcset="/banner-1000.webp 1000w, /banner.webp 2000w" sizes="(max-width: 1080px) 100vw, 1048px"
    width="2000" height="667" alt="${attr(name)}: bug no preço, commit no carrinho. Ofertas de tech, gadgets e setup" fetchpriority="high">
  <p>${escapeHtml(description)}</p>
  <p class="trust">✔️ Checamos o histórico de preço antes de postar · oferta esgotada sai daqui · links de afiliado (#publi)</p>
  ${join ? `<nav class="links">${join}</nav>` : ""}
</header>
<main>
${deals.length ? deals.map((d) => card(cfg, d)).join("\n") : `<p class="empty">Nenhuma promoção ativa agora. Volte daqui a pouco!</p>`}
</main>
<footer>
  <p>#publi · Os links são de afiliado: podemos ganhar uma comissão quando você compra, sem custo a mais para você.
  Preços e estoque podem mudar a qualquer momento; confira na loja antes de comprar.</p>
</footer>
${sticky ? `<nav class="sticky" aria-label="Entrar no grupo">${sticky}</nav>` : ""}
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
