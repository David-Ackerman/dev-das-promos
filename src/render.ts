import type { Channel, Marketplace } from "./types.ts";
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
}

const STORE: Record<Marketplace, string> = { amazon: "Amazon", shopee: "Shopee" };

/** Telegram, HTML parse mode. */
export function renderTelegram(p: RenderInput): string {
  const price =
    p.originalPriceCents && p.discountPct > 0
      ? `<s>${brl(p.originalPriceCents)}</s> por <b>${brl(p.priceCents)}</b> (-${p.discountPct}%)`
      : `<b>${brl(p.priceCents)}</b>`;
  return [
    escapeHtml(p.caption),
    "",
    `🛍️ <b>${escapeHtml(truncate(p.title, 110))}</b>`,
    `💸 ${price}`,
    `🏪 ${STORE[p.marketplace]}`,
    "",
    `🛒 ${escapeHtml(p.link)}`,
    p.footer ? `\n<i>${escapeHtml(p.footer)}</i>` : "",
  ]
    .join("\n")
    .trim();
}

/** WhatsApp formatting (*bold*, ~strike~, _italic_). */
export function renderWhatsApp(p: RenderInput): string {
  const price =
    p.originalPriceCents && p.discountPct > 0
      ? `~${brl(p.originalPriceCents)}~ por *${brl(p.priceCents)}* (-${p.discountPct}%)`
      : `*${brl(p.priceCents)}*`;
  return [
    p.caption,
    "",
    `🛍️ *${truncate(p.title, 110)}*`,
    `💸 ${price}`,
    `🏪 ${STORE[p.marketplace]}`,
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
  const price = p.discountPct > 0 ? `${brl(p.priceCents)} (-${p.discountPct}%)` : brl(p.priceCents);
  const tag = p.footer ? "#publi" : "";
  const build = (titleMax: number, short: string) =>
    [short, "", `${truncate(p.title, titleMax)} por ${price}`, linkOrNote, tag]
      .filter((l, i) => l !== "" || i === 1)
      .join("\n")
      .trim();
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
