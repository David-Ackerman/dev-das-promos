import { createHash } from "node:crypto";
import { slugify, toCents } from "@dev-das-promos/shared";
import { seededInt } from "./deterministic-random.js";
import { MOCK_CATALOG } from "./mock-catalog.js";
import { providerRequestSignal } from "./request.js";
import type {
  AffiliateContext,
  FetchOffersOptions,
  MarketplaceOfferData,
  MarketplaceProductData,
  MarketplaceProvider,
} from "./types.js";

/**
 * Deterministic mock retained for local development and demo seeding. The
 * real Affiliate Open API implementation is ShopeeOpenApiProvider below;
 * createShopeeProvider selects it when its approved app credentials exist.
 * There is no legitimate unofficial API for Shopee product or price data.
 */
export class ShopeeBrazilProvider implements MarketplaceProvider {
  readonly marketplace = "shopee_br" as const;

  constructor(private readonly affiliateId: string = "dasdeals") {}

  async fetchOffers(options: FetchOffersOptions = {}): Promise<MarketplaceOfferData[]> {
    const catalog = options.category
      ? MOCK_CATALOG.filter(
          (entry) =>
            entry.category === options.category || entry.parentCategory === options.category,
        )
      : MOCK_CATALOG;

    const limited = options.limit ? catalog.slice(0, options.limit) : catalog;

    return limited.map((entry) => this.toOffer(entry));
  }

  async getProduct(externalId: string): Promise<MarketplaceProductData | null> {
    const entry = MOCK_CATALOG.find((e) => this.externalIdFor(e.key) === externalId);
    if (!entry) return null;
    return this.toProduct(entry);
  }

  async buildAffiliateUrl(
    product: MarketplaceProductData,
    context: AffiliateContext = {},
  ): Promise<string> {
    const url = new URL(product.url);
    url.searchParams.set("af_id", this.affiliateId);
    if (context.subId) url.searchParams.set("sub_id", context.subId);
    if (context.campaign) url.searchParams.set("campaign", context.campaign);
    return url.toString();
  }

  private externalIdFor(key: string): string {
    // Shopee item ids are large numeric identifiers in practice.
    return String(seededInt(`shopee:${key}`, 1_000_000_000, 9_999_999_999));
  }

  private toOffer(entry: (typeof MOCK_CATALOG)[number]): MarketplaceOfferData {
    const externalId = this.externalIdFor(entry.key);
    // Shopee tends to run slightly lower list prices but more variable coupons.
    const priceJitterPct = seededInt(`shopee:price:${entry.key}`, -14, 2);
    const priceCents = Math.round(entry.basePriceCents * (1 + priceJitterPct / 100));
    const hasCoupon = seededInt(`shopee:coupon:${entry.key}`, 0, 100) > 55;
    const couponValueCents = hasCoupon
      ? Math.round(priceCents * (seededInt(`shopee:couponpct:${entry.key}`, 5, 20) / 100))
      : 0;
    const hasDiscount = seededInt(`shopee:discount:${entry.key}`, 0, 100) > 35;
    const originalPriceCents = hasDiscount
      ? Math.round(priceCents * (1 + seededInt(`shopee:origpct:${entry.key}`, 10, 45) / 100))
      : undefined;

    return {
      externalId,
      productName: entry.name,
      brand: entry.brand,
      imageUrl: entry.imageUrl,
      category: entry.category,
      description: entry.description,
      url: `https://shopee.com.br/product/${externalId}`,
      sellerName: `${entry.brand} Official Store`,
      sellerRating: seededInt(`shopee:rating:${entry.key}`, 60, 98),
      popularityScore: Math.max(
        0,
        entry.popularityScore - seededInt(`shopee:pop:${entry.key}`, 0, 10),
      ),
      priceCents,
      originalPriceCents,
      shippingPriceCents: seededInt(`shopee:shipping:${entry.key}`, 0, 1) === 0 ? 0 : 990,
      couponValueCents,
      currency: "BRL",
      availability: "in_stock",
      capturedAt: new Date(),
      metadata: { source: "mock", catalogKey: entry.key },
    };
  }

  private toProduct(entry: (typeof MOCK_CATALOG)[number]): MarketplaceProductData {
    const externalId = this.externalIdFor(entry.key);
    return {
      externalId,
      productName: entry.name,
      brand: entry.brand,
      imageUrl: entry.imageUrl,
      category: entry.category,
      description: entry.description,
      url: `https://shopee.com.br/product/${externalId}`,
      sellerName: `${entry.brand} Official Store`,
      sellerRating: seededInt(`shopee:rating:${entry.key}`, 60, 98),
      metadata: { source: "mock", catalogKey: entry.key, slug: slugify(entry.name) },
    };
  }
}

// ---------------------------------------------------------------------------
// Real integration: Shopee Affiliate Open API
// ---------------------------------------------------------------------------
//
// This is Shopee's affiliate/commission GraphQL API (distinct from the
// seller-facing Shopee Open Platform used for order/product management).
// Reference: https://open-api.affiliate.shopee.com.br/graphql -- an
// approved affiliate account is required to obtain an AppId/Secret pair.
//
// Request signing: every request is a POST of `{ query, variables }` with
// an `Authorization` header of the form
//   `SHA256 Credential=<AppId>, Timestamp=<unixSeconds>, Signature=<sig>`
// where `Signature = SHA256(AppId + Timestamp + Payload + Secret)`,
// `Payload` is the exact JSON body string, and `Timestamp` is a Unix
// timestamp in seconds that must stay within a few minutes of Shopee's
// server clock or the request is rejected.
//
// GraphQL errors come back as `{ errors: [{ message, extensions: { code,
// message } }] }` alongside (or instead of) a 2xx HTTP status -- a non-2xx
// status alone is not a reliable signal, so both are checked. Known error
// codes include 10020 (invalid signature), 10030 (rate limited), 10035 (no
// API access), 11001 (parameter error).

/** Credentials for the real Shopee Affiliate Open API. */
export interface ShopeeOpenApiCredentials {
  appId: string;
  appSecret: string;
  /** Same affiliate id concept the mock provider uses; only needed for the
   *  manual `?af_id=` fallback (see `buildAffiliateUrl`). */
  affiliateId?: string;
}

interface ShopeeGraphQLErrorExtensions {
  code?: number;
  message?: string;
}

interface ShopeeGraphQLError {
  message: string;
  path?: string[];
  extensions?: ShopeeGraphQLErrorExtensions;
}

interface ShopeeGraphQLResponse<T> {
  data?: T;
  errors?: ShopeeGraphQLError[];
}

interface ShopeeProductOfferNode {
  itemId: number;
  productName: string;
  productLink: string;
  offerLink: string;
  imageUrl?: string;
  priceMin?: string;
  priceMax?: string;
  priceDiscountRate?: number;
  sales?: number;
  ratingStar?: number;
  commissionRate?: string;
  sellerCommissionRate?: string;
  shopeeCommissionRate?: string;
  commission?: string;
  shopId?: number;
  shopName?: string;
  shopType?: number;
  periodStartTime?: number;
  periodEndTime?: number;
}

interface ShopeeProductOfferV2Response {
  productOfferV2: {
    nodes: ShopeeProductOfferNode[];
    pageInfo: { page: number; limit: number; hasNextPage: boolean };
  };
}

interface ShopeeGenerateShortLinkResponse {
  generateShortLink: { shortLink: string };
}

const SHOPEE_GRAPHQL_ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";
const SHOPEE_RATE_LIMIT_ERROR_CODE = 10030;
const MAX_REQUEST_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parses a Shopee-supplied money string into integer cents. Shopee's docs
 * describe these fields loosely as decimal/"R$" strings, so this tolerates
 * a "R$" prefix and either a plain decimal ("129.90") or Brazilian-locale
 * grouping ("1.299,90"). Reuses `toCents`'s Math.round-based rounding (the
 * same convention as every other `*Cents` field in this codebase) instead
 * of doing ad hoc float math here.
 */
function parseShopeeMoneyToCents(raw: string | undefined | null): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const trimmed = raw.replace(/R\$\s*/gi, "").trim();
  if (trimmed === "") return undefined;

  const normalized =
    trimmed.includes(",") && trimmed.lastIndexOf(",") > trimmed.lastIndexOf(".")
      ? trimmed.replace(/\./g, "").replace(",", ".")
      : trimmed;

  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return undefined;
  return toCents(value);
}

/**
 * Real Shopee integration via the Affiliate Open API (GraphQL). Requires an
 * approved affiliate app -- see `docs/providers.md`. Use `createShopeeProvider`
 * rather than constructing this directly, so callers automatically get the
 * deterministic mock when credentials aren't configured.
 */
export class ShopeeOpenApiProvider implements MarketplaceProvider {
  readonly marketplace = "shopee_br" as const;

  constructor(private readonly credentials: ShopeeOpenApiCredentials) {}

  async fetchOffers(options: FetchOffersOptions = {}): Promise<MarketplaceOfferData[]> {
    const query = `
      query ProductOfferV2($keyword: String, $page: Int, $limit: Int) {
        productOfferV2(keyword: $keyword, page: $page, limit: $limit) {
          nodes {
            itemId
            productName
            productLink
            offerLink
            imageUrl
            priceMin
            priceMax
            priceDiscountRate
            sales
            ratingStar
            commissionRate
            sellerCommissionRate
            shopeeCommissionRate
            commission
            shopId
            shopName
            shopType
            periodStartTime
            periodEndTime
          }
          pageInfo {
            page
            limit
            hasNextPage
          }
        }
      }
    `;

    const page = options.cursor ? Number.parseInt(options.cursor, 10) || 1 : 1;
    const variables = {
      keyword: options.category,
      page,
      limit: options.limit ?? 20,
    };

    const data = await this.request<ShopeeProductOfferV2Response>(query, variables);
    return data.productOfferV2.nodes.map((node) => this.toOffer(node));
  }

  async getProduct(externalId: string): Promise<MarketplaceProductData | null> {
    const itemId = Number.parseInt(externalId, 10);
    if (!Number.isFinite(itemId)) return null;

    const query = `
      query ProductOfferV2($itemId: Int) {
        productOfferV2(itemId: $itemId, limit: 1) {
          nodes {
            itemId
            productName
            productLink
            offerLink
            imageUrl
            shopId
            shopName
            ratingStar
          }
        }
      }
    `;

    const data = await this.request<ShopeeProductOfferV2Response>(query, { itemId });
    const node = data.productOfferV2.nodes[0];
    if (!node) return null;
    return this.toProduct(node);
  }

  async buildAffiliateUrl(
    product: MarketplaceProductData,
    context: AffiliateContext = {},
  ): Promise<string> {
    // Shopee's affiliate API exposes generateShortLink specifically for
    // turning a product/offer link into a tracked, shareable short link --
    // prefer it over hand-building the URL, since it's what actually
    // attributes clicks to this affiliate app server-side.
    const subIds = [context.subId, context.campaign].filter((value): value is string =>
      Boolean(value),
    );

    const mutation = `
      mutation GenerateShortLink($input: ShortLinkInput!) {
        generateShortLink(input: $input) {
          shortLink
        }
      }
    `;

    const data = await this.request<ShopeeGenerateShortLinkResponse>(mutation, {
      input: {
        originUrl: product.url,
        subIds: subIds.length > 0 ? subIds.slice(0, 5) : undefined,
      },
    });

    return data.generateShortLink.shortLink;
  }

  private toOffer(node: ShopeeProductOfferNode): MarketplaceOfferData {
    const priceCents = parseShopeeMoneyToCents(node.priceMin);
    if (priceCents === undefined || priceCents <= 0) {
      throw new Error(`Shopee offer ${node.itemId} has no valid positive priceMin`);
    }
    const variantPriceMaxCents = parseShopeeMoneyToCents(node.priceMax);

    let originalPriceCents: number | undefined;
    if (
      typeof node.priceDiscountRate === "number" &&
      node.priceDiscountRate > 0 &&
      node.priceDiscountRate < 100
    ) {
      originalPriceCents = Math.round(priceCents / (1 - node.priceDiscountRate / 100));
    }

    // Affiliate commission is revenue for the publisher, not a discount for
    // the shopper. Keep it as listing metadata and never subtract it from
    // the price used for discount scoring.
    const affiliateCommissionCents = parseShopeeMoneyToCents(node.commission);

    return {
      externalId: String(node.itemId),
      productName: node.productName,
      imageUrl: node.imageUrl,
      url: node.offerLink || node.productLink,
      sellerName: node.shopName,
      // sellerRating/popularityScore intentionally omitted: `ratingStar` on
      // this node is the item's own rating (not the seller's), and `sales`
      // is an unbounded raw count -- neither maps cleanly onto our
      // normalized 0-100 fields without fabricating a scale, so per the
      // task instructions we leave them undefined rather than guess.
      priceCents,
      originalPriceCents,
      currency: "BRL",
      // The Affiliate Open API doesn't expose stock/availability for
      // offer-search results.
      availability: "unknown",
      capturedAt: new Date(),
      metadata: {
        source: "shopee_openapi",
        shopId: node.shopId,
        shopType: node.shopType,
        sales: node.sales,
        ratingStar: node.ratingStar,
        commissionRate: node.commissionRate,
        sellerCommissionRate: node.sellerCommissionRate,
        shopeeCommissionRate: node.shopeeCommissionRate,
        affiliateCommissionCents,
        variantPriceMaxCents,
        periodStartTime: node.periodStartTime,
        periodEndTime: node.periodEndTime,
      },
    };
  }

  private toProduct(node: ShopeeProductOfferNode): MarketplaceProductData {
    return {
      externalId: String(node.itemId),
      productName: node.productName,
      imageUrl: node.imageUrl,
      url: node.offerLink || node.productLink,
      sellerName: node.shopName,
      metadata: {
        source: "shopee_openapi",
        shopId: node.shopId,
        ratingStar: node.ratingStar,
        slug: slugify(node.productName),
      },
    };
  }

  /**
   * Signs and sends one GraphQL request, retrying with exponential backoff
   * on rate-limit responses (HTTP 429 or GraphQL error code 10030), up to
   * `MAX_REQUEST_ATTEMPTS` attempts. Any other failure -- network error,
   * non-2xx status, or a GraphQL `errors` array -- throws immediately with
   * the underlying message rather than swallowing it or returning a
   * fabricated result.
   */
  private async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const payload = JSON.stringify({ query, variables });

    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHash("sha256")
        .update(`${this.credentials.appId}${timestamp}${payload}${this.credentials.appSecret}`)
        .digest("hex");

      let response: Response;
      try {
        response = await fetch(SHOPEE_GRAPHQL_ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `SHA256 Credential=${this.credentials.appId}, Timestamp=${timestamp}, Signature=${signature}`,
          },
          body: payload,
          signal: providerRequestSignal(),
        });
      } catch (error) {
        if (attempt < MAX_REQUEST_ATTEMPTS) {
          await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
          continue;
        }
        throw new Error(
          `Shopee Affiliate API request failed (network error) after ${MAX_REQUEST_ATTEMPTS} attempts: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      let body: ShopeeGraphQLResponse<T>;
      try {
        body = (await response.json()) as ShopeeGraphQLResponse<T>;
      } catch (error) {
        throw new Error(
          `Shopee Affiliate API returned a non-JSON response (HTTP ${response.status}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      const isRateLimited =
        response.status === 429 ||
        (body.errors?.some((e) => e.extensions?.code === SHOPEE_RATE_LIMIT_ERROR_CODE) ?? false);

      if (isRateLimited && attempt < MAX_REQUEST_ATTEMPTS) {
        await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }

      if (!response.ok || (body.errors && body.errors.length > 0)) {
        const message =
          body.errors && body.errors.length > 0
            ? body.errors.map((e) => e.extensions?.message ?? e.message).join("; ")
            : `HTTP ${response.status} ${response.statusText}`;
        throw new Error(`Shopee Affiliate API error: ${message}`);
      }

      if (!body.data) {
        throw new Error("Shopee Affiliate API returned an empty response body");
      }

      return body.data;
    }

    // Unreachable: the loop above always either returns or throws.
    throw new Error("Shopee Affiliate API request failed after exhausting retries");
  }
}

/**
 * Factory mirroring `createTelegramPublisher`'s fallback shape: returns the
 * real `ShopeeOpenApiProvider` only when both `appId` and `appSecret` are
 * present, otherwise falls back to the deterministic `ShopeeBrazilProvider`
 * mock so startup/ingestion/seed never require live credentials.
 */
export function createShopeeProvider(
  options: {
    affiliateId?: string;
    appId?: string;
    appSecret?: string;
  } = {},
): MarketplaceProvider {
  if (options.appId && options.appSecret) {
    return new ShopeeOpenApiProvider({
      appId: options.appId,
      appSecret: options.appSecret,
      affiliateId: options.affiliateId,
    });
  }
  return new ShopeeBrazilProvider(options.affiliateId);
}
