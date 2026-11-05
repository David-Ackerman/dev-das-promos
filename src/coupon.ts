import { inStore } from "./render.ts";
import type { Coupon, Marketplace } from "./types.ts";
import { brl, parsePriceToken } from "./util.ts";

/**
 * Coupons the admin sends with /cupom. Everything shown about a coupon (code,
 * discount, minimum, cap, validity, rules, how to use) comes from what the
 * admin typed and is laid out here; the AI only writes the one-line call above it.
 */

export const COUPON_HELP = `🎟️ <b>Postar um cupom</b>
Mande <code>/cupom</code> + código + link + desconto na primeira linha, e o resto nas linhas de baixo (tudo opcional, menos o link):

<code>/cupom KABUM10 https://seu-link-de-afiliado 10%
mínimo 200
máximo 50
validade 10/11 23:59
só no app, primeira compra
texto: Seu texto (senão a IA escreve)</code>

• Desconto: <code>10%</code>, <code>R$20</code> ou um texto (<code>desconto: frete grátis</code>).
• Sem código (cupom de resgatar no link)? É só não colocar o código.
• Validade: <code>10/11</code>, <code>10/11/2026 18:00</code>, <code>hoje</code>, <code>amanhã 23h</code>.
• Cada linha sem rótulo vira uma regra do cupom. <code>loja: Nome</code> troca o nome da loja.
O post explica como usar o cupom na loja, e cupom vencido não é publicado.`;

export interface CouponDraft {
  coupon: Coupon;
  link?: string;
  /** "loja: X" typed by the admin (display name). */
  store?: string;
  /** "texto: X": the admin's own call line. */
  caption?: string;
}

const URL_RE = /^https?:\/\/\S+$/i;
const LABEL = (names: string) => new RegExp(`^(?:${names})\\s*:?\\s*(.*)$`, "i");
const MIN_RE = LABEL("m[ií]nimo|compra m[ií]nima|pedido m[ií]nimo|acima de|a partir de");
const MAX_RE = LABEL("m[aá]ximo|desconto m[aá]ximo|teto|limite");
const VALID_RE = LABEL("validade|v[aá]lido at[eé]|v[aá]lida at[eé]|at[eé]|expira(?: em)?|vence(?: em)?");
const DISCOUNT_RE = LABEL("desconto|off");
const CODE_RE = LABEL("c[oó]digo|cupom");
const LINK_RE = LABEL("link");
const STORE_RE = LABEL("loja");
const TEXT_RE = LABEL("texto|legenda");
const RULE_RE = LABEL("regras?|condi[cç][oõ]es|obs");

/** "200", "R$ 200", "R$200,00" -> cents. */
function money(raw: string): number | undefined {
  return parsePriceToken(raw.replace(/\s+/g, "").replace(/reais$/i, ""));
}

/** "10%", "10% off", "R$20", "R$ 20 off", "20 reais" -> the discount; anything else -> text. */
function discountFrom(raw: string, into: Coupon): void {
  const text = raw.trim();
  const pct = text.match(/^(\d{1,2}(?:[.,]\d)?)\s*%(\s*off)?$/i);
  if (pct) {
    into.pctOff = Math.round(Number(pct[1]!.replace(",", ".")));
    return;
  }
  const cents = text.match(/^(?:R\$\s*)?(\d[\d.,]*)\s*(?:reais)?(\s*off)?$/i);
  if (cents && (/R\$|reais|off/i.test(text))) {
    const value = money(cents[1]!);
    if (value) {
      into.centsOff = value;
      return;
    }
  }
  if (text) into.discountText = text;
}

/** Brasília is UTC-3 all year (no daylight saving since 2019). */
const BRT_OFFSET_H = 3;

function brtParts(d: Date): { y: number; m: number; day: number } {
  const local = new Date(d.getTime() - BRT_OFFSET_H * 3_600_000);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, day: local.getUTCDate() };
}

/**
 * "10/11", "10/11/26", "10/11/2026 18:00", "hoje", "amanhã 23h" -> ISO time
 * (Brasília). Without a time: end of that day. A past date without a year means next year.
 */
export function parseValidity(raw: string, now = new Date()): string | undefined {
  const text = raw.trim().toLowerCase().replace(/\s+(às|as|a)\s+/, " ").replace(/\s+/g, " ");
  const parts = text.match(/^(hoje|amanh[aã]|(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?)(?: (\d{1,2})(?::(\d{2})|h(\d{2})?))?$/);
  if (!parts) return undefined;
  const hh = parts[5] !== undefined ? Number(parts[5]) : 23;
  const mm = parts[5] !== undefined ? Number(parts[6] ?? parts[7] ?? 0) : 59;
  const today = brtParts(now);
  let { y, m, day } = today;
  if (parts[1]!.startsWith("amanh")) ({ y, m, day } = brtParts(new Date(now.getTime() + 86_400_000)));
  else if (parts[2]) {
    day = Number(parts[2]);
    m = Number(parts[3]);
    y = parts[4] ? (parts[4].length === 2 ? 2000 + Number(parts[4]) : Number(parts[4])) : today.y;
    if (!parts[4] && (m < today.m || (m === today.m && day < today.day))) y++;
  }
  // 31/02 and friends: the date must exist.
  const date = new Date(Date.UTC(y, m - 1, day));
  if (m < 1 || m > 12 || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== day || hh > 23 || mm > 59) return undefined;
  return new Date(Date.UTC(y, m - 1, day, hh + BRT_OFFSET_H, mm)).toISOString();
}

/** Parses the text after /cupom. The first line holds code, link and discount in any order. */
export function parseCoupon(text: string, now = new Date()): CouponDraft {
  const lines = text.replace(/^\/cupom(@\w+)?/i, "").split("\n").map((l) => l.trim());
  const draft: CouponDraft = { coupon: { rules: [] } };
  const c = draft.coupon;

  let first = (lines.shift() ?? "").replace(/R\$\s+/gi, "R$").replace(/(\d)\s+(%|reais)/gi, "$1$2");
  // "acima de 99" / "mínimo R$ 99" on the first line is the minimum purchase.
  first = first.replace(/\b(?:acima de|a partir de|m[ií]nimo(?: de)?)\s+(R\$)?([\d.,]+)/i, (_, _r, value: string) => {
    c.minCents ??= money(value);
    return " ";
  });
  for (const token of first.split(/\s+/).filter(Boolean)) {
    if (URL_RE.test(token)) draft.link ??= token.replace(/[).,;!?]+$/, "");
    else if (/^\d{1,2}([.,]\d)?%$/.test(token) || /^R\$\d/i.test(token) || /^\d+reais$/i.test(token)) discountFrom(token, c);
    else if (/^off$/i.test(token)) continue;
    // Codes have a capital letter or a digit (KABUM10, PRIMEIRA, frete20); plain words are rules.
    else if (!c.code && /^[A-Za-z0-9][A-Za-z0-9_-]{2,29}$/.test(token) && /[A-Z0-9]/.test(token) && /[A-Za-z]/.test(token)) c.code = token;
    else c.rules.push(token);
  }
  // Leftover words on the first line read as one rule ("só no app"), not one rule per word.
  if (c.rules.length) c.rules = [c.rules.join(" ")];

  for (const raw of lines) {
    const line = raw.replace(/^[-•*]\s*/, "");
    if (!line) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(LINK_RE)) && URL_RE.test(m[1]!)) draft.link ??= m[1]!;
    else if (URL_RE.test(line)) draft.link ??= line;
    else if ((m = line.match(TEXT_RE))) draft.caption = m[1]!.trim() || undefined;
    else if ((m = line.match(STORE_RE))) draft.store = m[1]!.trim() || undefined;
    else if ((m = line.match(MIN_RE)) && money(m[1]!)) c.minCents = money(m[1]!);
    else if ((m = line.match(MAX_RE)) && money(m[1]!)) c.maxCents = money(m[1]!);
    else if ((m = line.match(VALID_RE)) && parseValidity(m[1]!, now)) c.validUntil = parseValidity(m[1]!, now);
    else if ((m = line.match(DISCOUNT_RE)) && m[1]) discountFrom(m[1], c);
    else if ((m = line.match(CODE_RE)) && /^\S{3,30}$/.test(m[1]!.trim())) c.code = m[1]!.trim();
    else if ((m = line.match(RULE_RE)) && m[1]) c.rules.push(m[1].trim());
    else c.rules.push(line);
  }
  c.rules = c.rules.filter(Boolean).slice(0, 6);
  return draft;
}

// ---------- how it looks in the posts ----------

export function discountLabel(c: Coupon): string {
  if (c.pctOff) return `${c.pctOff}% OFF`;
  if (c.centsOff) return `${brl(c.centsOff)} OFF`;
  return c.discountText ?? "desconto";
}

/** "10/11 às 23:59" in Brasília. */
export function validityLabel(iso: string): string {
  const local = new Date(new Date(iso).getTime() - BRT_OFFSET_H * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(local.getUTCDate())}/${p(local.getUTCMonth() + 1)} às ${p(local.getUTCHours())}:${p(local.getUTCMinutes())}`;
}

export function isExpired(validUntil: string | null | undefined, now = new Date()): boolean {
  return Boolean(validUntil && new Date(validUntil).getTime() < now.getTime());
}

/** "Compras a partir de R$ 200 · desconto máximo de R$ 50"; "" when neither is set. */
export function limitsLine(c: Coupon): string {
  return [c.minCents ? `Compras a partir de ${brl(c.minCents)}` : "", c.maxCents ? `desconto máximo de ${brl(c.maxCents)}` : ""]
    .filter(Boolean)
    .join(" · ");
}

/** Where to type the code in each store. `{code}` is replaced by each channel's formatting. */
const WHERE_TO_TYPE: Record<string, string> = {
  shopee: 'Na tela de pagamento, toque em "Cupom da Shopee", digite {code} e confirme',
  amazon: 'Na finalização do pedido, em "Adicionar cupom ou vale-presente", cole {code} e toque em Aplicar',
  mercadolivre: 'No resumo da compra, toque em "Inserir código de cupom" e cole {code}',
  aliexpress: 'No pagamento, toque em "Código promocional", cole {code} e aplique',
};

/** Step by step, from the coupon's own data. Lines may contain `{code}`. */
export function howToUse(marketplace: Marketplace, c: Coupon): string[] {
  const steps = c.code
    ? [
        "Toque no link e coloque os produtos no carrinho",
        WHERE_TO_TYPE[marketplace] ?? 'No pagamento, procure o campo "Cupom" (ou "Código de desconto"), cole {code} e toque em Aplicar',
      ]
    : ['Toque no link e resgate o cupom (botão "Pegar" ou "Resgatar")', "Coloque os produtos no carrinho: o cupom entra sozinho no pagamento"];
  if (c.minCents) steps.push(`O carrinho precisa ter pelo menos ${brl(c.minCents)}`);
  steps.push("Confira o desconto antes de pagar");
  return steps;
}

/** Product title for a coupon (admin lists, /stats). */
export function couponTitle(c: Coupon, store: string): string {
  return `Cupom ${c.code ? `${c.code} ` : ""}${discountLabel(c)} ${inStore(store)}`.replace(/\s+/g, " ");
}
