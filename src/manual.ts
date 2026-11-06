import type { Config } from "./config.ts";
import { fetchShopeeItem, shopeeAffiliateLink } from "./providers/shopee.ts";
import { storeName } from "./render.ts";
import type { Candidate, Marketplace } from "./types.ts";
import { discountPct, errorMessage, parsePriceToken, toCents } from "./util.ts";

type ShopeeConfig = NonNullable<Config["shopee"]>;

/**
 * Posts from a link the admin sends to the bot: any store (Amazon, Mercado
 * Livre, Shopee, AliExpress, KaBuM!…), usually the admin's affiliate link.
 * Runs in the Worker: fetch only.
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
  /** Name the admin typed when asked: wins over the page's. */
  title?: string;
}

const URL_RE = /https?:\/\/[^\s<>"]+/i;

export { parsePriceToken };

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
    // Share texts from the apps ("Acabei de encontrar isso no AliExpress:", "Confira este produto:") aren't the name.
    .replace(/^\s*(confira|olha|veja|d[êe] uma olhada|acabei de encontrar|encontrei|achei|i just found|check out)[^:]*:\s*/i, "")
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

/** Link shorteners: the store is only known after following the link. */
const SHORTENERS = new Set([
  "bit.ly", "bitly.com", "tinyurl.com", "cutt.ly", "t.co", "goo.gl", "is.gd", "ow.ly", "buff.ly", "rb.gy", "s.id",
  "shorturl.at", "tiny.cc", "rebrand.ly", "encurtador.com.br", "encurta.net", "tidd.ly", "linktr.ee", "l.instagram.com",
]);
/** Domain endings dropped to find the store's name: kabum.com.br -> kabum. */
const DOMAIN_ENDINGS = new Set(["com", "br", "net", "org", "shop", "store", "online", "app", "io", "co"]);
const STORE_ALIASES: Record<string, Marketplace> = { magazineluiza: "magalu", mercadolibre: "mercadolivre", terabyte: "terabyteshop" };

/** "www.kabum.com.br" -> "kabum", "divulgador.magalu.com" -> "magalu". */
export function storeKeyFromHost(host: string): Marketplace | undefined {
  const labels = host.toLowerCase().replace(/^www\d*\./, "").split(".");
  while (labels.length > 1 && DOMAIN_ENDINGS.has(labels[labels.length - 1] as string)) labels.pop();
  const key = (labels[labels.length - 1] ?? "").replace(/[^a-z0-9]/g, "");
  return key ? (STORE_ALIASES[key] ?? key) : undefined;
}

/** A store name the admin typed ("KaBuM!", "Magazine Luiza") -> its key ("kabum", "magalu"). */
export function storeKeyFromName(name: string): Marketplace {
  const key = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return STORE_ALIASES[key] ?? (key || "loja");
}

/**
 * Which store a link is from: the three with APIs, AliExpress, or any other
 * store keyed by its address. undefined for non-links and shorteners.
 */
export function marketplaceOf(url: string): Marketplace | undefined {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    host = u.hostname.toLowerCase();
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
  if (/(^|\.)shopee\.com\.br$/.test(host) || /(^|\.)shope\.ee$/.test(host) || /(^|\.)shp\.ee$/.test(host)) return "shopee";
  if (/(^|\.)aliexpress\.(com|us)$/.test(host) || host === "a.aliexpress.com") return "aliexpress";
  // Lookalikes such as amazon.com.evil.io must not pass as the real store.
  if (/(^|\.)(amazon|mercadolivre|shopee|aliexpress)\./.test(host)) return undefined;
  if (SHORTENERS.has(host) || !host.includes(".")) return undefined;
  return storeKeyFromHost(host);
}

/** ASIN / MLB id / Shopee item id / AliExpress item id from a product URL, so the same product is recognised across links. */
export function externalIdFrom(marketplace: Marketplace, url: string): string | undefined {
  if (marketplace === "amazon") return url.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?#]|$)/i)?.[1]?.toUpperCase();
  if (marketplace === "mercadolivre") {
    const id = url.match(/\b(MLB)-?(\d{6,})/i);
    return id ? `MLB${id[2]}` : undefined;
  }
  // Shopee: ".../Nome-i.<shop>.<item>" or ".../product/<shop>/<item>"; the item id alone, like the search API uses.
  // Short links from the app land on ".../<shop-name>/<shop>/<item>".
  if (marketplace === "shopee") {
    return (
      url.match(/-i\.\d+\.(\d+)(?:[/?#]|$)/)?.[1] ??
      url.match(/\/product\/\d+\/(\d+)(?:[/?#]|$)/)?.[1] ??
      url.match(/^https?:\/\/(?:[a-z0-9-]+\.)*shopee\.com\.br\/[^/?#]+\/\d{4,}\/(\d{4,})(?:[/?#]|$)/i)?.[1]
    );
  }
  if (marketplace === "aliexpress") return url.match(/\/item\/(\d{6,})\.html/)?.[1];
  return undefined;
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
  const shopee = path.match(/^\/(.+)-i\.\d+\.\d+\/?$/)?.[1];
  const slug = amazon ?? meli ?? shopee;
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

/** Page titles that mean "blocked / not a product", in any store. */
const NOT_A_PRODUCT =
  /^(amazon\.com\.br|mercado livre|shopee( brasil)?|aliexpress|robot check|página não encontrada|page not found|access denied|acesso negado|just a moment\.*|attention required!?.*|captcha.*|login|entrar|404.*|erro.*)$/i;

function cleanTitle(title: string | undefined): string | undefined {
  const t = title
    ?.replace(/^Amazon\.com\.br\s*:\s*/i, "")
    .replace(/\s*\|\s*(Amazon\.com\.br|Mercado Livre).*$/i, "")
    .replace(/\s*:\s*Amazon\.com\.br.*$/i, "")
    .replace(/\s+-\s+AliExpress(\s+\d+)?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    // Other stores end titles with "| Store name": drop it when what's left still reads like a product.
    .replace(/^(.{10,}?)\s*\|\s*[^|]{2,40}$/, "$1");
  return t && t.length >= 3 && !NOT_A_PRODUCT.test(t) ? t : undefined;
}

export interface PageInfo {
  /** Item id read from the page, when the URL doesn't carry one (showcase pages). */
  externalId?: string;
  title?: string;
  imageUrl?: string;
  priceCents?: number;
  originalPriceCents?: number;
}

/** Best-effort read of title, photo and prices from a product page (standard tags, plus Amazon / Mercado Livre specifics). */
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
  } else if (marketplace === "mercadolivre") {
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
    return go && marketplaceOf(url) === "mercadolivre" && marketplaceOf(go) === "mercadolivre" ? go : url;
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

/**
 * Shopee: a plain shopee.com.br product page carries no affiliate tracking, so
 * it becomes the admin's affiliate short link (Shopee API, sub-id = the post's
 * ref). Short links (s.shopee.com.br, shope.ee) are kept byte for byte.
 */
export async function shopeeLinkFor(
  shopee: ShopeeConfig | undefined,
  sentLink: string,
  ref: string,
): Promise<{ url: string; generated: boolean }> {
  if (!shopee || !isPlainShopeeProduct(sentLink)) return { url: sentLink, generated: false };
  try {
    return { url: await shopeeAffiliateLink(shopee, sentLink, ref), generated: true };
  } catch {
    return { url: sentLink, generated: false };
  }
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
Até 5 links de uma vez, um por linha. Aceito links de qualquer loja: Amazon, Mercado Livre, Shopee,
AliExpress, KaBuM!, Magalu… Normalmente eu leio nome, foto e preço sozinho; se a loja bloquear a
leitura, eu pergunto e você responde com o preço e o nome.
Links da Amazon sem a sua tag e links de produto da Shopee sem rastreio de afiliado ganham o seu link de afiliado automaticamente.

Para postar um cupom de desconto: <code>/cupom</code> (eu explico o formato).`;

export type BuildResult =
  | { ok: true; candidate: Candidate; caption?: string; via?: "shopee-api" }
  /** `ask`: the page couldn't be read; ask the admin for what's missing in one reply. */
  | { ok: false; reason: string; ask?: boolean };

/** First line of the bot's question when Amazon blocks the page (older questions still in the chat). */
export const AMAZON_ASK = "🛒 A Amazon bloqueia a leitura automática da página";
/** First words of the bot's question when a store's page can't be read; the reply is matched by it. */
export const STORE_ASK = "🛒 Não consegui ler";

/** Asks for what's missing; the link travels inside the question, so one reply finishes the post. */
export function askText(link: string, store: string, needName: boolean, needPrice: boolean, found?: string): string {
  const what = [needPrice && "o preço", needName && "o nome do produto"].filter(Boolean).join(" e ");
  return (
    `${STORE_ASK} ${what} na página do produto (${store}), então me diga.\n` +
    // What was read, so the admin only types what's missing (the name they type still wins).
    (found ? `Achei o produto: ${found}\n` : "") +
    `Responda esta mensagem assim: preço [preço antigo]${needName ? " Nome do produto" : " [nome do produto]"}\n` +
    `Ex.: 349,90 499,90${needName ? " Fone JBL Tune 520" : ""}\n` +
    "(nas linhas de baixo, se quiser, o texto do post)\n\n" +
    `🔗 ${link}`
  );
}

/** Kept for tests and old messages: the Amazon question. */
export function amazonAskText(link: string): string {
  return askText(link, "Amazon", true, true);
}

/**
 * The admin's reply to the question → a submission. First line: prices, then
 * the name (it wins over the page's); next lines: the post text.
 */
export function submissionFromReply(promptText: string | undefined, reply: string): Submission | undefined {
  if (!promptText?.startsWith(AMAZON_ASK) && !promptText?.startsWith(STORE_ASK)) return undefined;
  const link = promptText.match(/🔗 (https?:\/\/\S+)/)?.[1];
  if (!link) return undefined;
  const [first = "", ...rest] = reply.trim().split("\n");
  const parsed = parseSubmission(`${link} ${first}`);
  if (!parsed) return undefined;
  const text = rest.join("\n").trim();
  return { link, priceCents: parsed.priceCents, originalPriceCents: parsed.originalPriceCents, title: parsed.caption, caption: text || undefined };
}

/** Old name, same thing. */
export const submissionFromAmazonReply = submissionFromReply;

/** A shopee.com.br product page (not an affiliate short link): it carries no affiliate tracking. */
export function isPlainShopeeProduct(url: string): boolean {
  try {
    const u = new URL(url);
    return /^(www\.)?shopee\.com\.br$/i.test(u.hostname) && externalIdFrom("shopee", url) !== undefined;
  } catch {
    return false;
  }
}

/** Turns a submission into a Candidate, preferring what the admin typed over what the page or the API says. */
export async function buildCandidate(sub: Submission, opts: { shopee?: ShopeeConfig } = {}): Promise<BuildResult> {
  const initial = marketplaceOf(sub.link);
  const { finalUrl, page, error } = await fetchProductPage(sub.link);
  const marketplace = marketplaceOf(finalUrl) ?? initial ?? (error ? "loja" : undefined);
  if (!marketplace) return { ok: false, reason: "Não reconheci esse link. Mande o link do produto (ou o seu link de afiliado)." };

  // Shopee pages can't be read, but the affiliate API knows the item: name, photo, price, commission.
  const shopeeId = marketplace === "shopee" ? (externalIdFrom("shopee", finalUrl) ?? externalIdFrom("shopee", sub.link)) : undefined;
  const api = shopeeId && opts.shopee ? await fetchShopeeItem(opts.shopee, shopeeId).catch(() => null) : undefined;

  // When the page can't be read, the first line under the link is the product name.
  let caption = sub.caption;
  let title = sub.title ?? api?.title ?? page.title ?? titleFromUrl(finalUrl) ?? sub.before;
  if (!title && caption) {
    const [first, ...rest] = caption.split("\n");
    title = first?.trim() || undefined;
    caption = rest.join("\n").trim() || undefined;
  }
  const priceCents = sub.priceCents ?? api?.priceCents ?? page.priceCents;
  if (!title || !priceCents) {
    return { ok: false, reason: askText(sub.link, storeName(marketplace), !title, !priceCents, title), ask: true };
  }
  const originalPriceCents =
    sub.priceCents !== undefined ? sub.originalPriceCents : (api ? api.originalPriceCents : page.originalPriceCents);
  return {
    ok: true,
    candidate: {
      marketplace,
      externalId:
        shopeeId ??
        externalIdFrom(marketplace, finalUrl) ??
        page.externalId ??
        externalIdFrom(marketplace, sub.link) ??
        finalUrl.split(/[?#]/)[0]!,
      title,
      imageUrl: api?.imageUrl ?? page.imageUrl,
      productUrl: api?.productUrl ?? finalUrl,
      priceCents,
      originalPriceCents,
      discountPct: discountPct(priceCents, originalPriceCents),
      commissionRate: api?.commissionRate,
    },
    caption,
    via: api ? "shopee-api" : undefined,
  };
}
