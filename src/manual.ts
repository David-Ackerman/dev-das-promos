import type { Candidate, Marketplace } from "./types.ts";
import { discountPct, errorMessage, toCents } from "./util.ts";

/**
 * Posts from a link the admin sends to the bot (Amazon / Mercado Livre affiliate
 * links), for stores whose API we can't use yet. Runs in the Worker: fetch only.
 *
 * Message format (private chat with the bot):
 *   <link> [preço] [preço antigo]
 *   [texto do post, opcional, nas linhas seguintes]
 *
 * The link is kept exactly as sent: it already carries the affiliate tag.
 */
export interface Submission {
  link: string;
  priceCents?: number;
  originalPriceCents?: number;
  caption?: string;
  /** Text before the link (the Amazon app shares "Product name https://…"): the name when the page can't be read. */
  before?: string;
}

const URL_RE = /https?:\/\/[^\s<>"]+/i;

/** "129,90", "R$129,90", "1.299", "1.299,90", "129.90" -> cents; anything else -> undefined. */
export function parsePriceToken(raw: string): number | undefined {
  const token = raw.replace(/^R\$/i, "");
  if (/^\d{1,3}(\.\d{3})+$/.test(token)) return toCents(token.replace(/\./g, ""));
  if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(token) || /^\d+([.,]\d{1,2})?$/.test(token)) return toCents(token);
  return undefined;
}

export function parseSubmission(text: string): Submission | undefined {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => URL_RE.test(l));
  if (at < 0) return undefined;
  const line = lines[at] as string;
  const link = (line.match(URL_RE) as RegExpMatchArray)[0].replace(/[).,;!?]+$/, "");
  const after = line.slice(line.indexOf(link) + link.length).replace(/R\$\s*/gi, "R$");

  const prices: number[] = [];
  const words: string[] = [];
  for (const token of after.split(/\s+/).filter(Boolean)) {
    const cents = prices.length < 2 && !words.length ? parsePriceToken(token) : undefined;
    if (cents) prices.push(cents);
    else words.push(token);
  }
  const [a, b] = prices;
  const caption = [words.join(" "), ...lines.slice(at + 1)].join("\n").trim();
  const before = [...lines.slice(0, at), line.slice(0, line.indexOf(link))]
    .join(" ")
    .replace(/^\s*(confira|olha|veja)[^:]*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    link,
    priceCents: a !== undefined && b !== undefined ? Math.min(a, b) : a,
    originalPriceCents: a !== undefined && b !== undefined && a !== b ? Math.max(a, b) : undefined,
    caption: caption || undefined,
    before: before.length >= 6 ? before : undefined,
  };
}

export function marketplaceOf(url: string): Marketplace | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (
    /(^|\.)amazon\.com\.br$/.test(host) ||
    ["amzn.to", "amzn.eu", "amzn.com", "link.amazon", "amzlinks.in"].includes(host) ||
    /(^|\.)a\.co$/.test(host)
  ) {
    return "amazon";
  }
  if (/(^|\.)mercadolivre\.com(\.br)?$/.test(host) || /(^|\.)mercadolibre\.com$/.test(host) || host === "meli.la") {
    return "mercadolivre";
  }
  return undefined;
}

/** ASIN / MLB id from a product URL, so the same product is recognised across links. */
export function externalIdFrom(marketplace: Marketplace, url: string): string | undefined {
  if (marketplace === "amazon") return url.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?#]|$)/i)?.[1]?.toUpperCase();
  const id = url.match(/\b(MLB)-?(\d{6,})/i);
  return id ? `MLB${id[2]}` : undefined;
}

/** Human title from the URL slug, e.g. ".../Fone-Bluetooth-JBL/dp/..." -> "Fone Bluetooth JBL". */
export function titleFromUrl(url: string): string | undefined {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return undefined;
  }
  const amazon = path.match(/^\/([^/]+)\/(?:dp|gp\/product)\//)?.[1];
  const meli = path.match(/MLB-?\d+-(.+?)(?:-_JM)?$/i)?.[1] ?? path.match(/^\/([^/]+)\/p\/MLB\d+/i)?.[1];
  const slug = amazon ?? meli;
  if (!slug || slug.length < 6) return undefined;
  return slug.replace(/[-_]+/g, " ").trim();
}

// ---------- reading the product page ----------

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? decodeEntities(m[2] ?? m[3] ?? "") : undefined;
}

function meta(html: string, key: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const k = attr(tag, "property") ?? attr(tag, "name") ?? attr(tag, "itemprop");
    if (k?.toLowerCase() === key) return attr(tag, "content")?.trim() || undefined;
  }
  return undefined;
}

interface LdProduct {
  name?: string;
  image?: string | string[] | { url?: string };
  offers?: LdOffer | LdOffer[];
}
interface LdOffer {
  price?: string | number;
  lowPrice?: string | number;
}

function ldProduct(html: string): LdProduct | undefined {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1] as string) as unknown;
      const nodes = (Array.isArray(data) ? data : [data]).flatMap((n) =>
        n && typeof n === "object" && "@graph" in n ? ((n as { "@graph": unknown[] })["@graph"] ?? []) : [n],
      ) as Record<string, unknown>[];
      const product = nodes.find((n) => n && [n["@type"]].flat().includes("Product"));
      if (product) return product as LdProduct;
    } catch {
      // Broken JSON-LD: try the next block.
    }
  }
  return undefined;
}

function money(raw: string | number | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const cents = typeof raw === "number" ? toCents(raw) : parsePriceToken(raw.replace(/\s/g, ""));
  return cents && cents > 0 ? cents : undefined;
}

function cleanTitle(title: string | undefined): string | undefined {
  const t = title
    ?.replace(/^Amazon\.com\.br\s*:\s*/i, "")
    .replace(/\s*\|\s*(Amazon\.com\.br|Mercado Livre).*$/i, "")
    .replace(/\s*:\s*Amazon\.com\.br.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return t && !/^(amazon\.com\.br|mercado livre|robot check|página não encontrada)$/i.test(t) ? t : undefined;
}

export interface PageInfo {
  /** Item id read from the page, when the URL doesn't carry one (showcase pages). */
  externalId?: string;
  title?: string;
  imageUrl?: string;
  priceCents?: number;
  originalPriceCents?: number;
}

/** Best-effort read of title, photo and prices from an Amazon / Mercado Livre product page. */
export function parseProductPage(marketplace: Marketplace, html: string): PageInfo {
  const ld = ldProduct(html);
  const offer = [ld?.offers].flat()[0];
  const ldImage = [ld?.image].flat()[0];
  const info: PageInfo = {
    title: cleanTitle(ld?.name) ?? cleanTitle(meta(html, "og:title")),
    imageUrl: (typeof ldImage === "string" ? ldImage : ldImage?.url) ?? meta(html, "og:image"),
    priceCents: money(offer?.price ?? offer?.lowPrice) ?? money(meta(html, "product:price:amount") ?? meta(html, "price")),
  };

  if (marketplace === "amazon") {
    const title = html.match(/<span[^>]+id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i)?.[1];
    info.title = cleanTitle(title && decodeEntities(title)) ?? info.title ?? cleanTitle(html.match(/<title>([^<]*)<\/title>/i)?.[1]);
    const hidden = html.match(/name=["']items\[0\.base\]\[customerVisiblePrice\]\[amount\]["'][^>]*value=["']([\d.]+)["']/i)?.[1];
    const core = html.match(/(?:corePrice|apex)[\s\S]{0,2000}?<span class=["']a-offscreen["']>([^<]+)<\/span>/i)?.[1];
    info.priceCents = money(hidden) ?? money(core && decodeEntities(core).replace(/R\$/i, "")) ?? info.priceCents;
    const strike = html.match(/data-a-strike=["']true["'][^>]*>\s*<span class=["']a-offscreen["']>([^<]+)<\/span>/i)?.[1];
    info.originalPriceCents = money(strike && decodeEntities(strike).replace(/R\$/i, ""));
    const hiRes = html.match(/data-old-hires=["'](https:[^"']+)["']/i)?.[1] ?? html.match(/"hiRes":"(https:[^"]+)"/)?.[1];
    info.imageUrl = hiRes ?? info.imageUrl;
  } else {
    const before = html.match(/andes-money-amount--previous[^>]*aria-label=["'][^"']*?(\d[\d.]*) reais(?: com (\d{1,2}) centavos)?/i);
    if (before) info.originalPriceCents = Number((before[1] as string).replace(/\./g, "")) * 100 + Number(before[2] ?? 0);
    Object.assign(info, featuredCard(html));
  }
  // Telegram doesn't always take .webp as a photo; Mercado Livre serves the same image as .jpg.
  if (info.imageUrl && /mlstatic\.com\/.+\.webp$/i.test(info.imageUrl)) info.imageUrl = info.imageUrl.replace(/\.webp$/i, ".jpg");
  if (info.originalPriceCents && info.priceCents && info.originalPriceCents <= info.priceCents) {
    info.originalPriceCents = undefined;
  }
  return info;
}

/**
 * meli.la affiliate links land on the affiliate's showcase (/social/<name>): the
 * shared product is the first card after "card-featured", followed by other
 * products with their own prices, so only that card's numbers are used.
 */
function featuredCard(html: string): Partial<PageInfo> {
  const start = html.indexOf("card-featured");
  if (start < 0) return {};
  const id = /wid=(MLB\d+)/.exec(html.slice(start));
  if (!id) return {};
  const from = start + id.index;
  const next = html.indexOf("wid=MLB", from + id[0].length);
  const card = html.slice(from, next < 0 ? undefined : next);
  const track = card.match(/"tracks":\{"price":\{.*?"price":([\d.]+)\}/)?.[1];
  const current = card.match(/"current_price":\{"value":([\d.]+)/)?.[1];
  const previous = card.match(/"previous_price":\{"value":([\d.]+)/)?.[1];
  const out: Partial<PageInfo> = { externalId: id[1] };
  const price = money(track ?? current);
  if (price) out.priceCents = price;
  const original = money(previous);
  if (original) out.originalPriceCents = original;
  return out;
}

const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml",
  "accept-language": "pt-BR,pt;q=0.9",
};

/**
 * Mercado Livre sends robots to an account-verification page; the product URL is
 * still in its `go` parameter, which is enough for the item id and the name.
 */
export function unwrapVerification(url: string): string {
  try {
    const go = new URL(url).searchParams.get("go");
    return go && marketplaceOf(go) ? go : url;
  } catch {
    return url;
  }
}

/** Follows the link (short links redirect to the product) and reads the page. Never throws. */
export async function fetchProductPage(link: string): Promise<{ finalUrl: string; page: PageInfo; error?: string }> {
  try {
    const res = await fetch(link, { headers: BROWSER_HEADERS, redirect: "follow", signal: AbortSignal.timeout(8_000) });
    const landed = res.url || link;
    const finalUrl = unwrapVerification(landed);
    if (finalUrl !== landed) return { finalUrl, page: {}, error: "a loja pediu verificação" };
    const marketplace = marketplaceOf(finalUrl) ?? marketplaceOf(link);
    if (!res.ok || !marketplace) return { finalUrl, page: {}, error: `HTTP ${res.status}` };
    return { finalUrl, page: parseProductPage(marketplace, await res.text()) };
  } catch (error) {
    return { finalUrl: link, page: {}, error: errorMessage(error) };
  }
}

function tagOf(url: string): string | null {
  try {
    return new URL(url).searchParams.get("tag");
  } catch {
    return null;
  }
}

/**
 * The link the post will carry. Kept byte for byte when it's already your
 * affiliate link. Amazon links shared from the app (a.co/d/…, amzn.eu/…) or
 * plain product pages don't carry your tag: then the bot builds the standard
 * tagged link, amazon.com.br/dp/<ASIN>?tag=<AMAZON_PARTNER_TAG>, the same
 * format Amazon's own SiteStripe gives you.
 */
export function affiliateLinkFor(
  candidate: Pick<Candidate, "marketplace" | "productUrl">,
  sentLink: string,
  amazonTag: string | undefined,
): { url: string; generated: boolean } {
  if (candidate.marketplace !== "amazon" || !amazonTag) return { url: sentLink, generated: false };
  if (tagOf(sentLink) === amazonTag || tagOf(candidate.productUrl) === amazonTag) return { url: sentLink, generated: false };
  const asin = externalIdFrom("amazon", candidate.productUrl) ?? externalIdFrom("amazon", sentLink);
  if (!asin) return { url: sentLink, generated: false };
  return { url: `https://www.amazon.com.br/dp/${asin}?tag=${encodeURIComponent(amazonTag)}`, generated: true };
}

/** Several links in one message (one per line, with their prices): one preview each. */
export function parseSubmissions(text: string, max = 5): Submission[] {
  const urlLines = text.split("\n").filter((l) => URL_RE.test(l));
  if (urlLines.length <= 1) {
    const one = parseSubmission(text);
    return one ? [one] : [];
  }
  return urlLines
    .slice(0, max)
    .map((line) => parseSubmission(line))
    .filter((s): s is Submission => Boolean(s));
}

export const SUBMIT_HELP = `Para criar um post a partir de um link, me mande:
<code>link [preço] [preço antigo]</code>
e, se quiser, o texto do post nas linhas de baixo.

Ex.: <code>https://amzn.to/abc 129,90 199,90</code>
Até 5 links de uma vez, um por linha. Links da Amazon sem a sua tag (ex.: compartilhados do app) ganham a sua tag automaticamente.
Se eu não conseguir ler o nome do produto, eu aviso: aí mande o nome na linha de baixo do link.
Aceito links da Amazon e do Mercado Livre (inclusive meli.la). Normalmente eu leio nome, foto e preço
sozinho; se a loja bloquear a leitura, eu aviso e você manda o preço junto com o link.`;

export type BuildResult =
  | { ok: true; candidate: Candidate; caption?: string }
  /** `askAmazon`: Amazon blocked the page; ask the admin for price and name in one reply. */
  | { ok: false; reason: string; askAmazon?: boolean };

/** First line of the bot's question when Amazon blocks the page; the reply is matched by it. */
export const AMAZON_ASK = "🛒 A Amazon bloqueia a leitura automática da página";

export function amazonAskText(link: string): string {
  return (
    `${AMAZON_ASK}, então me diga o preço e o nome do produto.\n` +
    "Responda esta mensagem assim: preço [preço antigo] Nome do produto\n" +
    "Ex.: 349,90 499,90 Echo Dot 5ª geração\n" +
    "(nas linhas de baixo, se quiser, o texto do post)\n\n" +
    `🔗 ${link}`
  );
}

/** The admin's reply to amazonAskText → the same submission as "link price [old]\nName\n[text]". */
export function submissionFromAmazonReply(promptText: string | undefined, reply: string): Submission | undefined {
  if (!promptText?.startsWith(AMAZON_ASK)) return undefined;
  const link = promptText.match(/🔗 (https?:\/\/\S+)/)?.[1];
  if (!link) return undefined;
  const [first = "", ...rest] = reply.trim().split("\n");
  return parseSubmission(`${link} ${first}${rest.length ? `\n${rest.join("\n")}` : ""}`);
}

/** Turns a submission into a Candidate, preferring what the admin typed over what the page says. */
export async function buildCandidate(sub: Submission): Promise<BuildResult> {
  const initial = marketplaceOf(sub.link);
  const { finalUrl, page, error } = await fetchProductPage(sub.link);
  const marketplace = marketplaceOf(finalUrl) ?? initial;
  if (!marketplace) return { ok: false, reason: "Só aceito links da Amazon e do Mercado Livre por enquanto." };

  // When the page can't be read, the first line under the link is the product name.
  let caption = sub.caption;
  let title = page.title ?? titleFromUrl(finalUrl) ?? sub.before;
  if (!title && caption) {
    const [first, ...rest] = caption.split("\n");
    title = first?.trim() || undefined;
    caption = rest.join("\n").trim() || undefined;
  }
  const priceCents = sub.priceCents ?? page.priceCents;
  const missing = [!title && "o nome do produto", !priceCents && "o preço"].filter(Boolean).join(" e ");
  if (missing && marketplace === "amazon") return { ok: false, reason: amazonAskText(sub.link), askAmazon: true };
  if (missing) {
    return {
      ok: false,
      reason:
        `Não consegui ler ${missing} na página${error ? ` (${error})` : ""}. Mande de novo assim:\n` +
        `<code>link preço [preço antigo]\n${title ? "" : "Nome do produto\n"}[texto do post, opcional]</code>`,
    };
  }
  const originalPriceCents = sub.priceCents !== undefined ? sub.originalPriceCents : page.originalPriceCents;
  return {
    ok: true,
    candidate: {
      marketplace,
      externalId:
        externalIdFrom(marketplace, finalUrl) ??
        page.externalId ??
        externalIdFrom(marketplace, sub.link) ??
        finalUrl.split(/[?#]/)[0]!,
      title: title as string,
      imageUrl: page.imageUrl,
      productUrl: finalUrl,
      priceCents: priceCents as number,
      originalPriceCents,
      discountPct: discountPct(priceCents as number, originalPriceCents),
    },
    caption,
  };
}
