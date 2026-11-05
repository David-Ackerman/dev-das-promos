import { discountLabel, howToUse, limitsLine, validityLabel } from "./coupon.ts";
import type { Channel, Coupon, Marketplace } from "./types.ts";
import { brl, escapeHtml, truncate } from "./util.ts";

export interface RenderInput {
  caption: string;
  captionShort: string;
  title: string;
  marketplace: Marketplace;
  priceCents: number;
  originalPriceCents?: number | null;
  discountPct: number;
  link: string;
  footer: string;
  /** X only: brand/product hashtag without "#", shown next to #publi when it fits. */
  hashtag?: string | null;
  /** A coupon post (/cupom): code, discount, rules and how to use instead of a product price. */
  coupon?: Coupon | null;
}

/** Coupon details, step by step; `code` formats the code for the channel (Telegram: tap to copy). */
function couponBlock(p: RenderInput, c: Coupon, fmt: { bold: (s: string) => string; code: (s: string) => string; esc: (s: string) => string }): string[] {
  const store = c.store ?? storeName(p.marketplace);
  const limits = limitsLine(c);
  const steps = howToUse(p.marketplace, c).map((s, i) => `${i + 1}. ${fmt.esc(s).replace("{code}", c.code ? fmt.code(c.code) : "")}`);
  return [
    `🎟️ ${fmt.bold(fmt.esc(`Cupom ${store}: ${discountLabel(c)}`))}`,
    c.code ? `🔑 Código: ${fmt.code(c.code)}` : "🔑 Sem código: é só resgatar no link",
    limits ? `🛒 ${fmt.esc(limits)}` : "",
    c.validUntil ? `⏰ Válido até ${validityLabel(c.validUntil)}` : "",
    "",
    `📋 ${fmt.bold("Como usar")}`,
    ...steps,
    ...c.rules.map((r) => `• ${fmt.esc(r)}`),
  ].filter((l, i, all) => l !== "" || (all[i - 1] !== "" && i > 0));
}

const TELEGRAM_FMT = { bold: (s: string) => `<b>${s}</b>`, code: (s: string) => `<code>${escapeHtml(s)}</code>`, esc: escapeHtml };
const WHATSAPP_FMT = { bold: (s: string) => `*${s}*`, code: (s: string) => `\`${s}\``, esc: (s: string) => s };

/** How stores are written in posts; any other store is named from its key (its web address). */
export const STORE: Record<string, string> = {
  amazon: "Amazon",
  shopee: "Shopee",
  mercadolivre: "Mercado Livre",
  aliexpress: "AliExpress",
  magalu: "Magalu",
  kabum: "KaBuM!",
  americanas: "Americanas",
  casasbahia: "Casas Bahia",
  pontofrio: "Ponto",
  carrefour: "Carrefour",
  fastshop: "Fast Shop",
  pichau: "Pichau",
  terabyteshop: "Terabyte",
  netshoes: "Netshoes",
  centauro: "Centauro",
  shein: "Shein",
  temu: "Temu",
  submarino: "Submarino",
  girafa: "Girafa",
  samsung: "Samsung",
  lenovo: "Lenovo",
  dell: "Dell",
  nike: "Nike",
  adidas: "adidas",
  dafiti: "Dafiti",
  leroymerlin: "Leroy Merlin",
  madeiramadeira: "MadeiraMadeira",
  natura: "Natura",
  boticario: "O Boticário",
  loja: "Loja",
};

/** "na Shopee", "no Mercado Livre": Portuguese needs the store's gender. */
export function inStore(name: string): string {
  const masculine = /^(o\s+)?(mercado livre|aliexpress|magalu|ponto|carrefour|submarino|botic[aá]rio)(?![a-z])/i;
  return masculine.test(name) ? `no ${name.replace(/^o\s+/i, "")}` : `na ${name}`;
}

export function storeName(marketplace: Marketplace): string {
  return STORE[marketplace] ?? marketplace.charAt(0).toUpperCase() + marketplace.slice(1);
}

/** Telegram, HTML parse mode. */
export function renderTelegram(p: RenderInput): string {
  if (p.coupon) {
    return [escapeHtml(p.caption), "", ...couponBlock(p, p.coupon, TELEGRAM_FMT), "", `👉 ${escapeHtml(p.link)}`, p.footer ? `\n<i>${escapeHtml(p.footer)}</i>` : ""]
      .join("\n")
      .trim();
  }
  const price =
    p.originalPriceCents && p.discountPct > 0
      ? `<s>${brl(p.originalPriceCents)}</s> por <b>${brl(p.priceCents)}</b> (-${p.discountPct}%)`
      : `<b>${brl(p.priceCents)}</b>`;
  return [
    escapeHtml(p.caption),
    "",
    `🛍️ <b>${escapeHtml(truncate(p.title, 110))}</b>`,
    `💸 ${price}`,
    `🏪 ${storeName(p.marketplace)}`,
    "",
    `🛒 ${escapeHtml(p.link)}`,
    p.footer ? `\n<i>${escapeHtml(p.footer)}</i>` : "",
  ]
    .join("\n")
    .trim();
}

/** WhatsApp formatting (*bold*, ~strike~, _italic_). */
export function renderWhatsApp(p: RenderInput): string {
  if (p.coupon) {
    return [p.caption, "", ...couponBlock(p, p.coupon, WHATSAPP_FMT), "", `👉 ${p.link}`, p.footer ? `\n_${p.footer}_` : ""].join("\n").trim();
  }
  const price =
    p.originalPriceCents && p.discountPct > 0
      ? `~${brl(p.originalPriceCents)}~ por *${brl(p.priceCents)}* (-${p.discountPct}%)`
      : `*${brl(p.priceCents)}*`;
  return [
    p.caption,
    "",
    `🛍️ *${truncate(p.title, 110)}*`,
    `💸 ${price}`,
    `🏪 ${storeName(p.marketplace)}`,
    "",
    `🛒 ${p.link}`,
    p.footer ? `\n_${p.footer}_` : "",
  ]
    .join("\n")
    .trim();
}

/** X counts every URL as 23 characters. */
const X_URL_LENGTH = 23;
const X_LIMIT = 280;

export function xLength(text: string): number {
  return text.replace(/https?:\/\/\S+/g, "x".repeat(X_URL_LENGTH)).length;
}

/** Plain text for X. `link` undefined means "no-link" mode (cheaper on X's API). */
export function renderX(p: RenderInput, linkOrNote: string): string {
  if (p.coupon) {
    const c = p.coupon;
    const facts = [
      `🎟️ Cupom ${c.code ? `${c.code} ` : ""}${discountLabel(c)} ${inStore(c.store ?? storeName(p.marketplace))}`,
      [c.minCents ? `mín. ${brl(c.minCents)}` : "", c.validUntil ? `até ${validityLabel(c.validUntil).replace(" às ", " ")}` : ""].filter(Boolean).join(", "),
    ].filter(Boolean).join(" · ");
    const build = (short: string) => [short, "", facts, linkOrNote, p.footer ? "#publi" : ""].filter((l, i) => l !== "" || i === 1).join("\n").trim();
    let text = build(p.captionShort);
    if (xLength(text) > X_LIMIT) text = build(truncate(p.captionShort, Math.max(20, p.captionShort.length - (xLength(text) - X_LIMIT) - 1)));
    return text;
  }
  const price = p.discountPct > 0 ? `${brl(p.priceCents)} (-${p.discountPct}%)` : brl(p.priceCents);
  const tags = (withHashtag: boolean) =>
    [p.footer ? "#publi" : "", withHashtag && p.hashtag ? `#${p.hashtag}` : ""].filter(Boolean).join(" ");
  const build = (titleMax: number, short: string, withHashtag = false) =>
    [short, "", `${truncate(p.title, titleMax)} por ${price}`, linkOrNote, tags(withHashtag)]
      .filter((l, i) => l !== "" || i === 1)
      .join("\n")
      .trim();
  // The hashtag is the first thing to go: the joke is never cut to make room for it.
  if (p.hashtag) {
    for (const titleMax of [70, 40]) {
      const withTag = build(titleMax, p.captionShort, true);
      if (xLength(withTag) <= X_LIMIT) return withTag;
    }
  }
  let text = build(70, p.captionShort);
  if (xLength(text) > X_LIMIT) text = build(40, p.captionShort);
  if (xLength(text) > X_LIMIT) {
    const overflow = xLength(text) - X_LIMIT;
    text = build(40, truncate(p.captionShort, Math.max(20, p.captionShort.length - overflow - 1)));
  }
  return text;
}

export function render(channel: Channel, p: RenderInput, xLinkOrNote?: string): string {
  if (channel === "telegram") return renderTelegram(p);
  if (channel === "whatsapp") return renderWhatsApp(p);
  return renderX(p, xLinkOrNote ?? p.link);
}
