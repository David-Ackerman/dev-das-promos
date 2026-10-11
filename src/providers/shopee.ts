import type { Config } from "../config.ts";
import type { Candidate } from "../types.ts";
import { sha256Hex, sleep, toCents } from "../util.ts";

/**
 * Shopee Affiliate Open API (GraphQL), Brazil.
 * Docs: https://open-api.affiliate.shopee.com.br (needs an approved affiliate app).
 *
 * Auth header: `SHA256 Credential=<AppId>, Timestamp=<unix>, Signature=<sha256(AppId+Timestamp+Payload+Secret)>`
 * Errors may come back with HTTP 200 and an `errors` array, so both are checked.
 */
const ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";
const RATE_LIMIT_CODE = 10030;

type ShopeeConfig = NonNullable<Config["shopee"]>;

interface OfferNode {
  itemId: number | string;
  productName: string;
  productLink: string;
  offerLink?: string;
  imageUrl?: string;
  priceMin?: string;
  priceMax?: string;
  priceDiscountRate?: number;
  sales?: number;
  ratingStar?: string | number;
  commissionRate?: string;
}

export async function shopeeRequest<T>(
  cfg: ShopeeConfig,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const payload = JSON.stringify({ query, variables });
  for (let attempt = 1; attempt <= 3; attempt++) {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await sha256Hex(`${cfg.appId}${timestamp}${payload}${cfg.appSecret}`);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `SHA256 Credential=${cfg.appId}, Timestamp=${timestamp}, Signature=${signature}`,
      },
      body: payload,
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: T;
      errors?: { message: string; extensions?: { code?: number; message?: string } }[];
    };
    const limited =
      res.status === 429 || body.errors?.some((e) => e.extensions?.code === RATE_LIMIT_CODE);
    if (limited && attempt < 3) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (!res.ok || body.errors?.length) {
      const msg = body.errors?.map((e) => e.extensions?.message ?? e.message).join("; ");
      throw new Error(`Shopee API error: ${msg || `HTTP ${res.status}`}`);
    }
    if (!body.data) throw new Error("Shopee API returned no data");
    return body.data;
  }
  throw new Error("Shopee API: too many retries");
}

const SEARCH = `
query Offers($keyword: String, $sortType: Int, $page: Int, $limit: Int) {
  productOfferV2(keyword: $keyword, sortType: $sortType, page: $page, limit: $limit) {
    nodes {
      itemId productName productLink offerLink imageUrl
      priceMin priceMax priceDiscountRate sales ratingStar commissionRate
    }
  }
}`;

export function shopeeNodeToCandidate(node: OfferNode): Candidate | null {
  const priceCents = toCents(node.priceMin);
  if (!priceCents || priceCents <= 0 || !node.productLink) return null;
  const rate = Number(node.priceDiscountRate ?? 0);
  const discountPct = rate > 0 && rate < 100 ? Math.round(rate) : 0;
  const originalPriceCents =
    discountPct > 0 ? Math.round(priceCents / (1 - discountPct / 100)) : undefined;
  const commission = Number.parseFloat(String(node.commissionRate ?? ""));
  const rating = Number.parseFloat(String(node.ratingStar ?? ""));
  return {
    marketplace: "shopee",
    externalId: String(node.itemId),
    title: node.productName,
    imageUrl: node.imageUrl,
    productUrl: node.productLink,
    priceCents,
    originalPriceCents,
    discountPct,
    sales: typeof node.sales === "number" ? node.sales : undefined,
    rating: Number.isFinite(rating) ? rating : undefined,
    commissionRate: Number.isFinite(commission) ? commission : undefined,
  };
}

export async function fetchShopeeCandidates(cfg: ShopeeConfig, perKeyword = 20): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const keyword of cfg.keywords) {
    const data = await shopeeRequest<{ productOfferV2: { nodes: OfferNode[] } }>(cfg, SEARCH, {
      keyword,
      sortType: cfg.sortType,
      page: 1,
      limit: perKeyword,
    });
    for (const node of data.productOfferV2.nodes) {
      const c = shopeeNodeToCandidate(node);
      if (c) out.push(c);
    }
  }
  return out;
}

/** Turns a product link into our tracked affiliate short link. `subId` shows up in Shopee's reports. */
export async function shopeeAffiliateLink(
  cfg: ShopeeConfig,
  productUrl: string,
  subId: string,
): Promise<string> {
  const data = await shopeeRequest<{ generateShortLink: { shortLink: string } }>(
    cfg,
    `mutation Link($input: ShortLinkInput!) { generateShortLink(input: $input) { shortLink } }`,
    { input: { originUrl: productUrl, subIds: [subId] } },
  );
  return data.generateShortLink.shortLink;
}
