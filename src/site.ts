import { activeCampaign, type Config } from "./config.ts";
import type { DealDetail } from "./repo.ts";
import { discountLabel, limitsLine, validityLabel } from "./coupon.ts";
import { inStore, storeName } from "./render.ts";
import type { Coupon, Marketplace } from "./types.ts";
import { brl, escapeHtml, truncate } from "./util.ts";

/**
 * Public pages, server-rendered, no scripts:
 *  - GET / and /ofertas: what was published in the last days, each with its own
 *    /go link (channel "web") so /stats counts the clicks;
 *  - GET /oferta/:id-:slug: one deal with its price history and Product
 *    structured data, the page search engines and AI assistants link to.
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
/** "ai" = links handed out by the MCP server / API to AI assistants; "rss" = the feed. */
export const SITE_SOURCES = ["x", "ig", "tt", "yt", "tg", "wa", "share", "google", "ai", "rss"] as const;

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
  tiktok:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>',
  cart: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>',
};

function attr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

/** "nike air max 90 – preto/branco!" -> "nike-air-max-90-preto-branco": ASCII, ≤ 60 chars, whole words. */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= 60) return slug || "oferta";
  const cut = slug.slice(0, 61);
  return cut.slice(0, cut.lastIndexOf("-") > 20 ? cut.lastIndexOf("-") : 60).replace(/-+$/, "");
}

/** Path of a deal's own page: /oferta/123-teclado-mecanico-redragon. */
export function dealPath(id: number, title: string): string {
  return `/oferta/${id}-${slugify(title)}`;
}

export function dealUrl(cfg: Config, id: number, title: string): string {
  return `${cfg.publicBaseUrl}${dealPath(id, title)}`;
}

/** Store photos are absolute; ours (/img/<id>.jpg) already carry PUBLIC_BASE_URL, but be safe. */
function absolute(cfg: Config, url: string | null): string | undefined {
  if (!url) return undefined;
  return url.startsWith("/") ? `${cfg.publicBaseUrl}${url}` : url;
}

/** JSON for a <script type="application/ld+json">: "<" escaped so a title can't close the tag. */
function jsonLd(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

/** "Send to a friend" links point to the deal's page (?src=share), never to the affiliate link. */
function shareLinks(cfg: Config, d: SiteDeal): string {
  const page = `${dealUrl(cfg, d.id, d.title)}?src=share`;
  const text = `Olha essa oferta: ${truncate(d.title, 80)} por ${brl(d.price_cents)}`;
  const wa = `https://wa.me/?text=${encodeURIComponent(`${text} 👉 ${page}`)}`;
  const tg = `https://t.me/share/url?url=${encodeURIComponent(page)}&text=${encodeURIComponent(text)}`;
  return `<p class="share">Enviar pra um amigo:
      <a href="${attr(wa)}" rel="noopener" target="_blank" aria-label="Enviar no WhatsApp">${ICONS.whatsapp}</a>
      <a href="${attr(tg)}" rel="noopener" target="_blank" aria-label="Enviar no Telegram">${ICONS.telegram}</a></p>`;
}

/** Only when our own 30-day history backs it up; never "menor preço do Brasil". */
function isLowest(d: SiteDeal): boolean {
  return d.lowest_seen_cents !== null && d.price_cents <= d.lowest_seen_cents;
}

function tags(d: SiteDeal): string {
  return `<div class="tags"><span>${storeName(d.marketplace)}</span>${d.discount_pct > 0 ? `<span class="off">-${d.discount_pct}%</span>` : ""}${isLowest(d) ? `<span class="low">📉 Menor preço em 30 dias</span>` : ""}</div>`;
}

function priceHtml(d: SiteDeal): string {
  const old = d.original_price_cents && d.discount_pct > 0 ? `<s>${brl(d.original_price_cents)}</s> ` : "";
  return `<p class="price">${old}<b>${brl(d.price_cents)}</b></p>`;
}

/** Photo and title open the deal's own page (details + price history); "Ver oferta" goes to the store. */
function card(cfg: Config, d: SiteDeal): string {
  const href = `${cfg.publicBaseUrl}/go/${d.code}`;
  const pagePath = dealPath(d.id, d.title);
  return `<article class="deal" id="oferta-${d.id}">
  <a class="pic" href="${attr(pagePath)}" aria-label="Detalhes e histórico de preço: ${attr(truncate(d.title, 80))}">${d.image_url ? `<img src="${attr(d.image_url)}" alt="${attr(truncate(d.title, 100))}" loading="lazy" width="320" height="320">` : `<div class="noimg">🛍️</div>`}</a>
  <div class="body">
    ${tags(d)}
    <h2><a href="${attr(pagePath)}">${escapeHtml(truncate(d.title, 110))}</a></h2>
    <p class="joke">${escapeHtml(d.caption)}</p>
    ${priceHtml(d)}
    <a class="go" href="${attr(href)}" rel="nofollow sponsored noopener" target="_blank">${ICONS.cart}Ver oferta</a>
    <a class="info" href="${attr(pagePath)}">📈 Detalhes e histórico de preço</a>
    ${shareLinks(cfg, d)}
    <p class="when">Publicado ${escapeHtml(d.published)}</p>
  </div>
</article>`;
}

function joinButtons(cfg: Config): string {
  return [
    cfg.site.telegramUrl ? `<a class="join tg" href="${attr(cfg.site.telegramUrl)}" rel="noopener">${ICONS.telegram}Grupo no Telegram</a>` : "",
    cfg.site.whatsappUrl ? `<a class="join wa" href="${attr(cfg.site.whatsappUrl)}" rel="noopener">${ICONS.whatsapp}Grupo no WhatsApp</a>` : "",
    cfg.site.xUrl ? `<a class="join x" href="${attr(cfg.site.xUrl)}" rel="noopener">${ICONS.x}Seguir no X</a>` : "",
    cfg.site.tiktokUrl ? `<a class="join tt" href="${attr(cfg.site.tiktokUrl)}" rel="noopener">${ICONS.tiktok}Seguir no TikTok</a>` : "",
  ].join("");
}

/** Phones: the join buttons stay at the bottom of the screen while scrolling. */
function stickyButtons(cfg: Config): string {
  return [
    cfg.site.telegramUrl ? `<a class="join tg" href="${attr(cfg.site.telegramUrl)}" rel="noopener">${ICONS.telegram}Entrar no Telegram</a>` : "",
    cfg.site.whatsappUrl ? `<a class="join wa" href="${attr(cfg.site.whatsappUrl)}" rel="noopener">${ICONS.whatsapp}WhatsApp</a>` : "",
  ].join("");
}

export function siteDescription(cfg: Config): string {
  return cfg.ai.niche
    ? `Promoções de ${cfg.ai.niche}, escolhidas a dedo na Shopee, Amazon e Mercado Livre.`
    : "Promoções escolhidas a dedo na Shopee, Amazon e Mercado Livre.";
}

interface Head {
  title: string;
  description: string;
  canonical: string;
  image: string;
  imageSize?: [number, number];
  type: "website" | "product";
  extra?: string;
}

/** Sale-day strip on top of every page, while a campaign is on. */
function campaignBar(cfg: Config): string {
  const c = activeCampaign(cfg);
  return c ? `<div class="campaign" role="note">🔥 <b>${escapeHtml(c.tag)}</b><span> · descontos checados no histórico de preço</span></div>\n` : "";
}

function page(cfg: Config, h: Head, body: string): string {
  const sticky = stickyButtons(cfg);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(h.title)}</title>
<meta name="description" content="${attr(h.description)}">
<link rel="canonical" href="${attr(h.canonical)}">
<link rel="alternate" type="application/rss+xml" title="${attr(cfg.site.name)}" href="/feed.xml">
<meta property="og:site_name" content="${attr(cfg.site.name)}">
<meta property="og:locale" content="pt_BR">
<meta property="og:title" content="${attr(h.title)}">
<meta property="og:description" content="${attr(h.description)}">
<meta property="og:type" content="${h.type === "product" ? "product" : "website"}">
<meta property="og:url" content="${attr(h.canonical)}">
<meta property="og:image" content="${attr(h.image)}">
${h.imageSize ? `<meta property="og:image:width" content="${h.imageSize[0]}">\n<meta property="og:image:height" content="${h.imageSize[1]}">` : ""}
<meta name="twitter:card" content="summary_large_image">
${cfg.site.googleVerification ? `<meta name="google-site-verification" content="${attr(cfg.site.googleVerification)}">\n` : ""}${cfg.site.bingVerification ? `<meta name="msvalidate.01" content="${attr(cfg.site.bingVerification)}">\n` : ""}${h.extra ?? ""}
<style>${STYLE}</style>
</head>
<body${sticky ? ' class="has-sticky"' : ""}>
${campaignBar(cfg)}${body}
<footer>
  <p>#publi · Os links são de afiliado: podemos ganhar uma comissão quando você compra, sem custo a mais para você.
  Preços e estoque podem mudar a qualquer momento; confira na loja antes de comprar.</p>
  <p><a href="/">Ofertas de hoje</a> · <a href="/feed.xml">Feed RSS</a> · <a href="/llms.txt">Para IAs e agentes (MCP)</a> · <a href="/privacidade">Privacidade</a></p>
</footer>
${sticky ? `<nav class="sticky" aria-label="Entrar no grupo">${sticky}</nav>` : ""}
</body>
</html>`;
}

/** A live coupon on the home page: code to copy, rules in short, and the tracked link. */
export interface SiteCoupon {
  marketplace: string;
  coupon: Coupon | null;
  code: string;
}

function couponCard(cfg: Config, s: SiteCoupon): string {
  const c = s.coupon;
  if (!c) return "";
  const store = c.store ?? storeName(s.marketplace);
  const details = [limitsLine(c), c.validUntil ? `válido até ${validityLabel(c.validUntil)}` : "", ...c.rules].filter(Boolean).join(" · ");
  return `<article class="coupon">
  <p class="ctitle">🎟️ <b>${escapeHtml(discountLabel(c))}</b> ${escapeHtml(inStore(store))}</p>
  ${c.code ? `<p class="ccode">Código: <code>${escapeHtml(c.code)}</code></p>` : `<p class="ccode">Sem código: resgate no link</p>`}
  ${details ? `<p class="joke">${escapeHtml(details)}</p>` : ""}
  <a class="go" href="${attr(`${cfg.publicBaseUrl}/go/${s.code}`)}" rel="nofollow sponsored noopener" target="_blank">${c.code ? "Usar cupom" : "Pegar cupom"} ${escapeHtml(inStore(store))}</a>
</article>`;
}

export function sitePage(cfg: Config, deals: SiteDeal[], coupons: SiteCoupon[] = []): string {
  const name = cfg.site.name;
  const description = siteDescription(cfg);
  const join = joinButtons(cfg);
  const home = `${cfg.publicBaseUrl}/`;
  const sameAs = [cfg.site.xUrl, cfg.site.tiktokUrl, cfg.site.telegramUrl, cfg.site.whatsappUrl].filter(Boolean);
  const ld = jsonLd([
    { "@context": "https://schema.org", "@type": "WebSite", name, url: home, inLanguage: "pt-BR", description },
    { "@context": "https://schema.org", "@type": "Organization", name, url: home, logo: `${cfg.publicBaseUrl}/og.jpg`, ...(sameAs.length ? { sameAs } : {}) },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `${name}: promoções de hoje`,
      itemListElement: deals.map((d, i) => ({ "@type": "ListItem", position: i + 1, url: dealUrl(cfg, d.id, d.title), name: d.title })),
    },
  ]);
  return page(
    cfg,
    { title: `${name} · Promoções de hoje`, description, canonical: home, image: `${cfg.publicBaseUrl}/og.jpg`, imageSize: [1200, 556], type: "website", extra: ld },
    `<header>
  <h1 class="sr-only">${escapeHtml(name)}</h1>
  <img class="banner" src="/banner.webp" srcset="/banner-1000.webp 1000w, /banner.webp 2000w" sizes="(max-width: 1080px) 100vw, 1048px"
    width="2000" height="667" alt="${attr(name)}: bug no preço, commit no carrinho. Ofertas de tech, gadgets e setup" fetchpriority="high">
  <p>${escapeHtml(description)}</p>
  <p class="trust">✔️ Checamos o histórico de preço antes de postar · oferta esgotada sai daqui · links de afiliado (#publi)</p>
  ${join ? `<nav class="links">${join}</nav>` : ""}
</header>
${coupons.length ? `<section class="coupons" aria-label="Cupons ativos"><h2>🎟️ Cupons ativos</h2><div class="clist">${coupons.map((c) => couponCard(cfg, c)).join("\n")}</div></section>` : ""}
<main>
${deals.length ? deals.map((d) => card(cfg, d)).join("\n") : `<p class="empty">Nenhuma promoção ativa agora. Volte daqui a pouco!</p>`}
</main>`,
  );
}

/** "2026-10-27" -> "27/10" */
function ddmm(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** Step chart of the daily lowest price, as inline SVG (no scripts, readable by crawlers via the text below it). */
export function priceChart(history: { day: string; price_cents: number }[]): string {
  if (history.length < 2) return "";
  const W = 640;
  const H = 200;
  const pad = { l: 96, r: 12, t: 14, b: 30 };
  const prices = history.map((h) => h.price_cents);
  let lo = Math.min(...prices);
  let hi = Math.max(...prices);
  if (hi === lo) {
    hi += Math.max(100, Math.round(hi * 0.05));
    lo = Math.max(0, lo - Math.max(100, Math.round(lo * 0.05)));
  }
  const t0 = Date.parse(history[0]!.day);
  const span = Math.max(1, Date.parse(history[history.length - 1]!.day) - t0);
  const x = (day: string) => pad.l + ((Date.parse(day) - t0) / span) * (W - pad.l - pad.r);
  const y = (c: number) => pad.t + (1 - (c - lo) / (hi - lo)) * (H - pad.t - pad.b);
  let d = "";
  history.forEach((h, i) => {
    const px = x(h.day).toFixed(1);
    const py = y(h.price_cents).toFixed(1);
    d += i === 0 ? `M${px} ${py}` : `H${px}V${py}`;
  });
  const last = history[history.length - 1]!;
  d += `H${(W - pad.r).toFixed(1)}`;
  const minI = prices.indexOf(Math.min(...prices));
  const minP = history[minI]!;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Histórico de preço de ${ddmm(history[0]!.day)} a ${ddmm(last.day)}">
  <g font-size="16" fill="currentColor" opacity="0.7">
    <text x="${pad.l - 8}" y="${y(hi) + 4}" text-anchor="end">${brl(hi)}</text>
    <text x="${pad.l - 8}" y="${y(lo) + 4}" text-anchor="end">${brl(lo)}</text>
    <text x="${pad.l}" y="${H - 6}">${ddmm(history[0]!.day)}</text>
    <text x="${W - pad.r}" y="${H - 6}" text-anchor="end">${ddmm(last.day)}</text>
  </g>
  <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(lo)}" y2="${y(lo)}" stroke="currentColor" stroke-opacity="0.15"/>
  <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(hi)}" y2="${y(hi)}" stroke="currentColor" stroke-opacity="0.15"/>
  <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round"/>
  <circle cx="${x(minP.day).toFixed(1)}" cy="${y(minP.price_cents).toFixed(1)}" r="5" fill="#1971c2"/>
</svg>`;
}

/** Plain-language summary of the history: what people search ("histórico de preço X") and what AI assistants quote. */
export function historyFacts(d: DealDetail, history: { day: string; price_cents: number }[]): string[] {
  if (!history.length) return [];
  const prices = history.map((h) => h.price_cents);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const minDay = history[prices.indexOf(min)]!.day;
  const facts = [
    `Menor preço que registramos nos últimos 90 dias: ${brl(min)} (${ddmm(minDay)}).`,
    `Maior preço registrado no período: ${brl(max)}.`,
    `Preço quando publicamos esta oferta: ${brl(d.price_cents)}.`,
    `Dias com registro de preço: ${history.length}.`,
  ];
  if (min === max) facts.splice(1, 1);
  return facts;
}

function statusLine(d: DealDetail): string {
  if (d.ended) return `<p class="status ended">⛔ Oferta encerrada: esgotou ou o preço subiu depois de ${escapeHtml(d.published)}. O histórico abaixo continua valendo pra comparar.</p>`;
  if (!d.live) return `<p class="status">🕒 Oferta publicada em ${escapeHtml(d.published)}: o preço pode ter mudado. Confira o preço atual na loja.</p>`;
  return `<p class="status live">✅ Oferta ativa, publicada ${escapeHtml(d.published)}. Preço e estoque podem mudar a qualquer momento.</p>`;
}

/** A deal's own page: the URL shared, indexed and handed to AI assistants. */
export function dealPage(
  cfg: Config,
  d: DealDetail,
  history: { day: string; price_cents: number }[],
  more: (SiteDeal & { shared?: number })[],
): string {
  const url = dealUrl(cfg, d.id, d.title);
  const store = storeName(d.marketplace);
  const image = absolute(cfg, d.image_url) ?? `${cfg.publicBaseUrl}/og.jpg`;
  const price = brl(d.price_cents);
  const title = d.live ? `${truncate(d.title, 70)} por ${price} ${inStore(store)}` : `${truncate(d.title, 70)}: histórico de preço`;
  const facts = historyFacts(d, history);
  const description = truncate(
    d.live
      ? `${d.title} por ${price}${d.discount_pct > 0 ? ` (-${d.discount_pct}%)` : ""} ${inStore(store)}. ${facts[0] ?? ""}`
      : `Histórico de preço de ${d.title} ${inStore(store)}. ${facts[0] ?? ""}`,
    160,
  );
  const product: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: d.title,
    image: [image],
    description: d.caption || d.title,
    url,
  };
  // Price claims only while the deal is live: an old page must not tell Google the price still holds.
  if (d.live) {
    product.offers = {
      "@type": "Offer",
      url,
      price: (d.price_cents / 100).toFixed(2),
      priceCurrency: "BRL",
      availability: "https://schema.org/InStock",
      seller: { "@type": "Organization", name: store },
    };
  }
  const ld = jsonLd([
    product,
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: cfg.site.name, item: `${cfg.publicBaseUrl}/` },
        { "@type": "ListItem", position: 2, name: truncate(d.title, 80), item: url },
      ],
    },
  ]);
  const meta = d.live
    ? `<meta property="product:price:amount" content="${(d.price_cents / 100).toFixed(2)}">\n<meta property="product:price:currency" content="BRL">\n${ld}`
    : ld;
  const join = joinButtons(cfg);
  const chart = priceChart(history);
  return page(
    cfg,
    { title: `${title} · ${cfg.site.name}`, description, canonical: url, image, type: "product", extra: meta },
    `<div class="wrap">
<nav class="top"><a href="/">← <b>${escapeHtml(cfg.site.name)}</b></a><a href="/">Todas as ofertas de hoje</a></nav>
<article class="detail">
  ${d.image_url ? `<img src="${attr(d.image_url)}" alt="${attr(truncate(d.title, 120))}" width="480" height="480">` : `<div class="noimg">🛍️</div>`}
  <div>
    ${tags(d)}
    <h1>${escapeHtml(d.title)}</h1>
    ${statusLine(d)}
    <p class="joke">${escapeHtml(d.caption)}</p>
    ${priceHtml(d)}
    <a class="go" href="${attr(`${cfg.publicBaseUrl}/go/${d.code}`)}" rel="nofollow sponsored noopener" target="_blank">${ICONS.cart}${d.live ? `Ver oferta ${inStore(store)}` : `Ver preço atual ${inStore(store)}`}</a>
    ${shareLinks(cfg, d)}
  </div>
</article>
<section class="box">
  <h2>Histórico de preço</h2>
  ${chart || '<p class="joke">Ainda temos poucos registros de preço deste produto.</p>'}
  ${facts.length ? `<ul class="facts">${facts.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>` : ""}
</section>
${join ? `<section class="box"><h2>Receba ofertas assim primeiro</h2><p class="joke">A gente checa o histórico de preço antes de postar. Desconto fake não passa.</p><nav class="links">${join}</nav></section>` : ""}
${more.length ? `<section><h2 style="margin:20px 0 4px">${more.some((m) => (m.shared ?? 0) > 0) ? "Produtos parecidos" : "Mais ofertas de hoje"}</h2><div class="more">${more.map((m) => card(cfg, m)).join("\n")}</div></section>` : ""}
</div>`,
  );
}

/** Simple privacy notice: needed to list the API as a ChatGPT GPT action, and good to have anyway. */
export function privacyPage(cfg: Config): string {
  const name = escapeHtml(cfg.site.name);
  return page(
    cfg,
    { title: `Privacidade · ${cfg.site.name}`, description: `Como o ${cfg.site.name} trata dados de quem visita o site.`, canonical: `${cfg.publicBaseUrl}/privacidade`, image: `${cfg.publicBaseUrl}/og.jpg`, type: "website" },
    `<div class="wrap"><nav class="top"><a href="/">← <b>${name}</b></a></nav>
<section class="box">
  <h1 style="margin-top:0">Privacidade</h1>
  <p>O ${name} é um site de ofertas com links de afiliado. Não pedimos cadastro, não usamos cookies de rastreamento nem scripts de terceiros.</p>
  <ul>
    <li><b>Visitas:</b> contamos quantas visitas cada página recebe por dia e de qual origem (ex.: X, Instagram), sem identificar ninguém.</li>
    <li><b>Cliques em ofertas:</b> ao clicar em “Ver oferta”, registramos data, país aproximado, navegador (user agent), página de origem e um código irreversível derivado do IP (hash), só para contar cliques e filtrar robôs. Depois você vai para a loja, que tem a própria política de privacidade.</li>
    <li><b>API e assistentes de IA:</b> as buscas feitas pela API ou pelo servidor MCP não são guardadas com dados pessoais; só contamos os cliques nos links que elas devolvem, como acima.</li>
    <li><b>Grupos:</b> no Telegram contamos entradas e saídas por link de convite usando um código irreversível no lugar do seu ID.</li>
  </ul>
  <p>Não vendemos nem compartilhamos esses dados. Dúvidas ou pedidos de remoção: fale com a gente pelo ${cfg.site.xUrl ? `<a href="${attr(cfg.site.xUrl)}">X</a>` : "grupo"}.</p>
</section></div>`,
  );
}

const STYLE = `  :root { color-scheme: light dark; --bg: #f6f7f9; --card: #fff; --fg: #14171a; --muted: #5b6672; --line: #e3e7ec; --accent: #e8590c; --accent-fg: #fff; --ok: #2b8a3e; }
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
  .join.x, .join.tt { background: var(--fg); color: var(--bg); }
  .pic { display: block; }
  .coupons { max-width: 1080px; margin: 0 auto; padding: 8px 16px 0; }
  .coupons h2 { font-size: 17px; margin: 0 0 8px; }
  .clist { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  .coupon { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; background: var(--card); border: 2px dashed var(--accent); border-radius: 14px; }
  .coupon p { margin: 0; }
  .ccode code { font-size: 16px; font-weight: 700; padding: 2px 8px; border-radius: 6px; background: var(--line); user-select: all; }
  .info { text-align: center; font-size: 13px; color: var(--muted); }
  main { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); padding-top: 16px; padding-bottom: 24px; }
  .deal { display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .deal img, .noimg { width: 100%; aspect-ratio: 1; max-height: 240px; object-fit: contain; background: #fff; }
  .noimg { display: grid; place-items: center; font-size: 48px; background: var(--line); }
  .body { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px 14px; flex: 1; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; font-size: 12px; font-weight: 700; }
  .tags span { white-space: nowrap; }
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

  a { color: inherit; }
  h2 a { text-decoration: none; }
  h2 a:hover { text-decoration: underline; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 0 4px; font-size: 14px; }
  .top a { color: var(--muted); text-decoration: none; }
  .top b { font-size: 16px; }
  .detail { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px; margin-top: 8px; }
  @media (max-width: 720px) { .detail { grid-template-columns: 1fr; } }
  .detail img, .detail .noimg { width: 100%; aspect-ratio: 1; object-fit: contain; background: #fff; border-radius: 12px; max-height: none; }
  .detail h1 { margin: 6px 0 8px; font-size: 22px; line-height: 1.25; }
  .detail .price { font-size: 26px; margin: 10px 0; }
  .detail .go { font-size: 17px; padding: 12px; }
  .status { margin: 0 0 10px; padding: 8px 12px; border-radius: 10px; font-size: 14px; background: var(--line); }
  .status.live { background: color-mix(in srgb, var(--ok) 18%, transparent); }
  .status.ended { background: color-mix(in srgb, #e03131 18%, transparent); }
  section.box { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px; margin-top: 16px; }
  section.box h2 { font-size: 18px; margin-bottom: 8px; }
  .chart { width: 100%; max-width: 680px; height: auto; display: block; }
  .facts { margin: 8px 0 0; padding-left: 18px; color: var(--muted); font-size: 14px; }
  .more { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); margin-top: 8px; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 16px 24px; }
  .campaign { background: linear-gradient(90deg, #c92a2a, var(--accent)); color: #fff; text-align: center; padding: 10px 16px; font-size: 15px; line-height: 1.35; }
  @media (max-width: 640px) { .campaign span { display: block; font-size: 13px; opacity: 0.9; } }
  footer a { color: var(--muted); }
`;
