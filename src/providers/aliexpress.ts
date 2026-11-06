import type { Config } from "../config.ts";
import type { Candidate } from "../types.ts";
import { toCents } from "../util.ts";

/**
 * AliExpress Affiliate API (official, AliExpress Open Platform), used for links
 * the admin sends: AliExpress pages carry no price (it's loaded by script), but
 * `aliexpress.affiliate.productdetail.get` gives name, photo, price in BRL and
 * commission for an item id. Needs an app approved at openservice.aliexpress.com.
 *
 * Request (TOP style): POST https://api-sg.aliexpress.com/sync, system params in
 * the query, business params in the body, `sign` = MD5(secret + sorted(k+v) +
 * secret), uppercase hex, over both. Runs in the Worker and in Node: fetch only.
 */
const ENDPOINT = "https://api-sg.aliexpress.com/sync";

type AliConfig = NonNullable<Config["aliexpress"]>;

interface AliProduct {
  product_id?: number | string;
  product_title?: string;
  product_main_image_url?: string;
  product_detail_url?: string;
  target_sale_price?: string;
  target_original_price?: string;
  target_sale_price_currency?: string;
  commission_rate?: string;
  evaluate_rate?: string;
  lastest_volume?: number;
}

/** MD5 hex (RFC 1321). Web Crypto in Node has no MD5, and the API requires it. */
export function md5Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const words = new Uint32Array((((bytes.length + 8) >>> 6) + 1) * 16);
  for (let i = 0; i < bytes.length; i++) words[i >>> 2]! |= bytes[i]! << ((i % 4) * 8);
  words[bytes.length >>> 2]! |= 0x80 << ((bytes.length % 4) * 8);
  words[words.length - 2] = (bytes.length * 8) >>> 0;
  words[words.length - 1] = Math.floor((bytes.length * 8) / 2 ** 32);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let chunk = 0; chunk < words.length; chunk += 16) {
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) [f, g] = [(b & c) | (~b & d), i];
      else if (i < 32) [f, g] = [(d & b) | (~d & c), (5 * i + 1) % 16];
      else if (i < 48) [f, g] = [b ^ c ^ d, (3 * i + 5) % 16];
      else [f, g] = [c ^ (b | ~d), (7 * i) % 16];
      const tmp = d;
      d = c;
      c = b;
      const sum = (a + f + K[i]! + words[chunk + g]!) >>> 0;
      const s = S[(i >>> 4) * 4 + (i % 4)]!;
      b = (b + ((sum << s) | (sum >>> (32 - s)))) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0]
    .map((n) => [0, 8, 16, 24].map((shift) => ((n >>> shift) & 0xff).toString(16).padStart(2, "0")).join(""))
    .join("");
}

/** The API's signature: MD5 of secret + every param as key+value in key order + secret, uppercase. */
export function aliSign(secret: string, params: Record<string, string>): string {
  const body = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("");
  return md5Hex(`${secret}${body}${secret}`).toUpperCase();
}

/** "7.0%" -> 0.07 (same scale as Shopee's commissionRate). */
function rate(raw: string | undefined): number | undefined {
  const n = Number.parseFloat(String(raw ?? "").replace("%", ""));
  return Number.isFinite(n) && n > 0 ? n / 100 : undefined;
}

export function aliProductToCandidate(p: AliProduct): Candidate | null {
  const priceCents = toCents(p.target_sale_price);
  if (!p.product_id || !p.product_title || !priceCents || priceCents <= 0) return null;
  if (p.target_sale_price_currency && p.target_sale_price_currency !== "BRL") return null;
  const original = toCents(p.target_original_price);
  const originalPriceCents = original && original > priceCents ? original : undefined;
  const rating = Number.parseFloat(String(p.evaluate_rate ?? "").replace("%", ""));
  return {
    marketplace: "aliexpress",
    externalId: String(p.product_id),
    title: p.product_title.trim(),
    imageUrl: p.product_main_image_url,
    productUrl: p.product_detail_url ?? `https://pt.aliexpress.com/item/${p.product_id}.html`,
    priceCents,
    originalPriceCents,
    discountPct: originalPriceCents ? Math.round(((originalPriceCents - priceCents) / originalPriceCents) * 100) : 0,
    sales: typeof p.lastest_volume === "number" ? p.lastest_volume : undefined,
    // evaluate_rate is "% positive"; shown on a 0-5 scale like the other stores.
    rating: Number.isFinite(rating) && rating > 0 ? Math.round((rating / 20) * 10) / 10 : undefined,
    commissionRate: rate(p.commission_rate),
  };
}

/**
 * One item by id, priced in BRL for Brazil.
 * undefined = AliExpress doesn't offer it (anymore); null = answered, but not usable.
 * Throws on network / auth errors (the caller decides what to do).
 */
export async function fetchAliExpressItem(cfg: AliConfig, productId: string): Promise<Candidate | null | undefined> {
  if (!/^\d{6,20}$/.test(productId)) return null;
  const system: Record<string, string> = {
    app_key: cfg.appKey,
    method: "aliexpress.affiliate.productdetail.get",
    sign_method: "md5",
    timestamp: String(Date.now()),
    format: "json",
    v: "2.0",
  };
  const business: Record<string, string> = {
    product_ids: productId,
    target_currency: "BRL",
    target_language: "PT",
    country: "BR",
    ...(cfg.trackingId ? { tracking_id: cfg.trackingId } : {}),
  };
  const query = new URLSearchParams({ ...system, sign: aliSign(cfg.appSecret, { ...system, ...business }) });
  const res = await fetch(`${ENDPOINT}?${query}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams(business),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error_response?: { code?: string; msg?: string; sub_msg?: string };
    aliexpress_affiliate_productdetail_get_response?: {
      resp_result?: { resp_code?: number; resp_msg?: string; result?: { current_record_count?: number; products?: { product?: AliProduct[] } } };
    };
  };
  if (json.error_response) {
    const e = json.error_response;
    throw new Error(`AliExpress API: ${e.sub_msg || e.msg || e.code || `HTTP ${res.status}`}`);
  }
  const result = json.aliexpress_affiliate_productdetail_get_response?.resp_result;
  if (!res.ok || !result) throw new Error(`AliExpress API: HTTP ${res.status}`);
  if (result.resp_code !== 200) throw new Error(`AliExpress API: ${result.resp_msg ?? result.resp_code}`);
  const product = result.result?.products?.product?.find((p) => String(p.product_id) === productId);
  if (!product) return result.result?.current_record_count ? null : undefined;
  return aliProductToCandidate(product);
}
