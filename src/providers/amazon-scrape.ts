import { parsePriceToken } from "../manual.ts";
import type { Candidate } from "../types.ts";
import { discountPct, errorMessage, sleep as realSleep } from "../util.ts";

/**
 * Opt-in reader of public Amazon.com.br search pages (AMAZON_SCRAPE=on), for
 * when there is no Creators API access. It can conflict with the Associates
 * agreement, so it is off by default and polite: a few requests per run, a
 * 2-4 s pause between them, and it stops at the first captcha page.
 *
 * Runs anywhere `fetch` exists (GitHub Actions or the Worker): no `node:*`.
 * Parsing is plain regex/string work over the server-rendered HTML; the
 * /deals page is rendered client-side, so it is not read here.
 */
export interface AmazonScrapeConfig {
  partnerTag: string;
  /** Search terms, one request per term and page. */
  queries: string[];
  /** Keep only offers with at least this discount. */
  minDiscountPct?: number;
  /** Result pages per term (default 1). */
  maxPages?: number;
  /** Base pause between requests; the real one is delayMs..2*delayMs (default 2000). */
  delayMs?: number;
}

export interface ScrapedItem {
  asin: string;
  title: string;
  priceCents: number;
  originalPriceCents?: number;
  discountPct: number;
  imageUrl?: string;
  rating?: number;
  reviewCount?: number;
  sponsored: boolean;
}

export interface AmazonScrapeDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

const BASE = "https://www.amazon.com.br";
const ASIN_RE = /^[A-Z0-9]{10}$/;
const BLOCK_MESSAGE =
  "Amazon bloqueou a busca (captcha) — tente mais tarde / Amazon blocked the search (captcha), try again later";

const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "upgrade-insecure-requests": "1",
};

// ---------- small HTML helpers ----------

const NAMED: Record<string, string> = {
  quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  reg: "®", trade: "™", copy: "©", deg: "°", ordm: "º", ordf: "ª", times: "×",
};
const ACCENTS: Record<string, string> = { acute: "́", grave: "̀", tilde: "̃", circ: "̂", uml: "̈", cedil: "̧" };

/** Numeric entities, the common named ones and pt-BR letters (&eacute;, &ccedil;...). */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (all, name: string) => {
      if (NAMED[name] !== undefined) return NAMED[name];
      const m = name.match(/^([a-z])(acute|grave|tilde|circ|uml|cedil)$/i);
      return m ? `${m[1]}${ACCENTS[(m[2] as string).toLowerCase()]}`.normalize("NFC") : all;
    })
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? decodeEntities(m[2] ?? m[3] ?? "") : undefined;
}

function hasClass(tag: string, cls: string): boolean {
  return ` ${attr(tag, "class") ?? ""} `.replace(/\s+/g, " ").includes(` ${cls} `);
}

function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** "R$ 1.299,90" / "R$&nbsp;49,90" -> cents. */
function priceCents(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const token = decodeEntities(raw).replace(/R\$/i, "").replace(/\s/g, "");
  const cents = parsePriceToken(token);
  return cents && cents > 0 ? cents : undefined;
}

/** "4,6 de 5 estrelas" / "4.6 out of 5 stars" -> 4.6 */
function parseRating(raw: string): number | undefined {
  const m = raw.match(/(\d(?:[.,]\d)?)\s*(?:de|out of)\s*5/i);
  const value = m ? Number((m[1] as string).replace(",", ".")) : Number.NaN;
  return value >= 0 && value <= 5 ? value : undefined;
}

/** "1.234" / "(1,2 mil)" / "12,5 mil" / "1,234" -> count. */
function parseCount(raw: string): number | undefined {
  const m = raw.match(/(\d[\d.,]*)\s*(mil|k)?/i);
  if (!m) return undefined;
  const digits = m[1] as string;
  if (m[2]) {
    const value = Number(digits.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(value) ? Math.round(value * 1000) : undefined;
  }
  const value = Number(digits.replace(/[.,]/g, ""));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Thumbnail -> big image: drops the `._AC_UL320_` size part (same as the X publisher's bestImageUrl). */
export function largeAmazonImage(url: string): string {
  if (!/\/\/[^/]*media-amazon\.com\/images\//i.test(url)) return url;
  return url.replace(/\._[^/.]*_\.(jpe?g|png|webp)$/i, "._AC_SL1500_.$1");
}

// ---------- search page ----------

const RESULT_TAG = /<div\b[^>]*\sdata-component-type\s*=\s*["']s-search-result["'][^>]*>/gi;

function isSponsored(openTag: string, block: string): boolean {
  return (
    hasClass(openTag, "AdHolder") ||
    /puis-sponsored-label|s-sponsored-label|sp-sponsored-result|\/sspa\/click|\/slredirect\//i.test(block) ||
    /data-component-type\s*=\s*["']sp-sponsored-result["']/i.test(block) ||
    />\s*Patrocinado\s*</i.test(block)
  );
}

function titleOf(block: string): string | undefined {
  const h2 = block.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
  if (!h2) return undefined;
  const label = attr(h2[0].slice(0, h2[0].indexOf(">") + 1), "aria-label");
  const title = text(h2[1] as string) || label?.replace(/\s+/g, " ").trim();
  return title?.replace(/^(Anúncio patrocinado|Patrocinado)\s*[–—:-]\s*/i, "") || undefined;
}

/** Current price and the struck "De:" price, from the `a-price` spans. */
function pricesOf(block: string): { price?: number; list?: number } {
  let price: number | undefined;
  let list: number | undefined;
  const re = /(<span\b[^>]*class\s*=\s*["'][^"']*\ba-price\b[^"']*["'][^>]*>)\s*<span\b[^>]*\ba-offscreen\b[^>]*>([^<]*)<\/span>/gi;
  for (const m of block.matchAll(re)) {
    const tag = m[1] as string;
    const cents = priceCents(m[2]);
    if (!cents) continue;
    const before = text(block.slice(Math.max(0, (m.index ?? 0) - 160), m.index));
    const struck = attr(tag, "data-a-strike") === "true" || /(?:^|\s)(De|Preço de lista|List|Típico)\s*:?\s*$/i.test(before);
    if (struck) list ??= cents;
    else if (!hasClass(tag, "a-text-price")) price ??= cents; // a-text-price without strike = unit price ("R$ 2,10/un")
  }
  return { price, list };
}

function imageOf(block: string): string | undefined {
  const img = (block.match(/<img\b[^>]*>/gi) ?? []).find((t) => hasClass(t, "s-image"));
  if (!img) return undefined;
  const srcset = attr(img, "srcset");
  const best = srcset
    ?.split(",")
    .map((part) => part.trim().split(/\s+/))
    .filter((p) => p[0])
    .sort((a, b) => Number.parseFloat(b[1] ?? "1") - Number.parseFloat(a[1] ?? "1"))[0]?.[0];
  const url = best ?? attr(img, "src");
  return url && /^https:\/\//i.test(url) ? largeAmazonImage(url) : undefined;
}

function reviewsOf(block: string): number | undefined {
  for (const m of block.matchAll(/aria-label\s*=\s*["']([^"']*)["']/gi)) {
    const label = decodeEntities(m[1] as string);
    if (/avalia|classifica|ratings|reviews/i.test(label) && !/de 5|out of 5/i.test(label)) {
      const n = parseCount(label);
      if (n) return n;
    }
  }
  const underline = block.match(/<span\b[^>]*\bs-underline-text\b[^>]*>([^<]*)<\/span>/i)?.[1];
  return underline ? parseCount(decodeEntities(underline)) : undefined;
}

/**
 * Results of an Amazon.com.br search page (`/s?k=...`). Items without ASIN or
 * price are dropped; sponsored ones too unless `includeSponsored`.
 */
export function parseAmazonSearchHtml(html: string, opts: { includeSponsored?: boolean } = {}): ScrapedItem[] {
  const starts = [...html.matchAll(RESULT_TAG)];
  const out: ScrapedItem[] = [];
  starts.forEach((m, i) => {
    const openTag = m[0];
    const block = html.slice(m.index ?? 0, starts[i + 1]?.index ?? html.length);
    const asin = attr(openTag, "data-asin")?.trim().toUpperCase();
    if (!asin || !ASIN_RE.test(asin)) return;
    const sponsored = isSponsored(openTag, block);
    if (sponsored && !opts.includeSponsored) return;
    const { price, list } = pricesOf(block);
    const title = titleOf(block);
    if (!price || !title) return;
    let originalPriceCents = list && list > price ? list : undefined;
    let pct = discountPct(price, originalPriceCents);
    const badge = Number(block.match(/>\s*-\s?(\d{1,2})\s?%\s*</)?.[1] ?? 0);
    if (!originalPriceCents && badge > 0) {
      pct = badge;
      originalPriceCents = Math.round(price / (1 - badge / 100));
    }
    const ratingText = [...block.matchAll(/<span\b[^>]*\ba-icon-alt\b[^>]*>([^<]*)<\/span>/gi)].map((r) => r[1]).join(" ");
    const ratingLabel = block.match(/aria-label\s*=\s*["']([^"']*(?:de|out of)\s*5[^"']*)["']/i)?.[1] ?? "";
    out.push({
      asin,
      title,
      priceCents: price,
      originalPriceCents,
      discountPct: pct,
      imageUrl: imageOf(block),
      rating: parseRating(decodeEntities(ratingText)) ?? parseRating(decodeEntities(ratingLabel)),
      reviewCount: reviewsOf(block),
      sponsored,
    });
  });
  return out;
}

/** Amazon's robot check / captcha page (or its 503 "sorry" page). */
export function isAmazonBlockPage(html: string, status: number): boolean {
  if (status === 503 || status === 429) return true;
  return /\/errors\/validateCaptcha|captchacharacters|Digite os caracteres que você vê abaixo|Type the characters you see in this image|To discuss automated access to Amazon data|api-services-support@amazon\.com|<title>\s*Robot Check\s*<\/title>|não é um robô|not a robot/i.test(
    html,
  );
}

/** amazon.com.br/dp/<ASIN>?tag=<tag>: the SiteStripe link format (same as manual.ts affiliateLinkFor). */
export function amazonAffiliateUrl(asin: string, tag: string): string {
  const id = asin.trim().toUpperCase();
  if (!ASIN_RE.test(id)) throw new Error(`Invalid ASIN: ${asin}`);
  if (!tag.trim()) throw new Error("AMAZON_PARTNER_TAG is required for Amazon links");
  return `${BASE}/dp/${id}?tag=${encodeURIComponent(tag.trim())}`;
}

export function amazonSearchUrl(query: string, page = 1): string {
  const params = new URLSearchParams({ k: query });
  if (page > 1) params.set("page", String(page));
  return `${BASE}/s?${params}`;
}

function toCandidate(item: ScrapedItem, tag: string): Candidate {
  return {
    marketplace: "amazon",
    externalId: item.asin,
    title: item.title,
    imageUrl: item.imageUrl,
    productUrl: amazonAffiliateUrl(item.asin, tag),
    priceCents: item.priceCents,
    originalPriceCents: item.originalPriceCents,
    discountPct: item.discountPct,
    rating: item.rating,
  };
}

/**
 * Searches each query (up to maxPages pages), best discount first. Stops at
 * the first captcha; throws only when that left nothing at all.
 */
export async function fetchAmazonScrapedCandidates(
  cfg: AmazonScrapeConfig,
  deps: AmazonScrapeDeps = {},
): Promise<Candidate[]> {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const pause = deps.sleep ?? realSleep;
  const log = deps.log ?? (() => {});
  if (!cfg.partnerTag.trim()) throw new Error("AMAZON_PARTNER_TAG is required for Amazon links");
  const maxPages = Math.max(1, cfg.maxPages ?? 1);
  const delay = Math.max(0, cfg.delayMs ?? 2000);

  const items = new Map<string, ScrapedItem>();
  let requests = 0;
  let answered = 0;
  let blocked = false;
  let lastError: string | undefined;

  search: for (const query of cfg.queries.map((q) => q.trim()).filter(Boolean)) {
    for (let page = 1; page <= maxPages; page++) {
      if (requests++ > 0) await pause(delay + Math.round(Math.random() * delay));
      const url = amazonSearchUrl(query, page);
      let status: number;
      let html: string;
      try {
        const res = await doFetch(url, { headers: BROWSER_HEADERS, redirect: "follow", signal: AbortSignal.timeout(15_000) });
        status = res.status;
        html = await res.text();
      } catch (error) {
        lastError = errorMessage(error);
        log(`Amazon (busca) "${query}" p${page}: ${lastError}`);
        break;
      }
      if (isAmazonBlockPage(html, status)) {
        blocked = true;
        log(`Amazon (busca) "${query}" p${page}: captcha/bloqueio (HTTP ${status}); parando`);
        break search;
      }
      if (status < 200 || status >= 300) {
        lastError = `HTTP ${status}`;
        log(`Amazon (busca) "${query}" p${page}: HTTP ${status}`);
        break;
      }
      answered++;
      const found = parseAmazonSearchHtml(html);
      log(`Amazon (busca) "${query}" p${page}: ${found.length} itens`);
      for (const item of found) {
        const seen = items.get(item.asin);
        if (!seen || item.discountPct > seen.discountPct) items.set(item.asin, item);
      }
      if (!found.length) break;
    }
  }

  if (!items.size && blocked) throw new Error(BLOCK_MESSAGE);
  if (!items.size && !answered && lastError) throw new Error(`Amazon (busca) falhou / failed: ${lastError}`);
  const min = cfg.minDiscountPct ?? 0;
  return [...items.values()]
    .filter((i) => i.discountPct >= min)
    .sort((a, b) => b.discountPct - a.discountPct)
    .map((i) => toCandidate(i, cfg.partnerTag));
}
