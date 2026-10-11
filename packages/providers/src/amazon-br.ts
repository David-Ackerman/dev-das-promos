import { type Availability, slugify, toCents } from "@dev-das-promos/shared";
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
 * MOCK provider. The real implementation, `AmazonCreatorsApiProvider`
 * below, uses Amazon's Creators API under an approved Associates account
 * -- there is no legitimate unofficial API for Amazon product data.
 * `createAmazonProvider()` at the bottom of this file picks between the
 * two behind the same `MarketplaceProvider` interface; nothing else in
 * the pipeline needs to change. See docs/providers.md.
 */
export class AmazonBrazilProvider implements MarketplaceProvider {
  readonly marketplace = "amazon_br" as const;

  constructor(private readonly affiliateTag: string = "dasdeals-20") {}

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
    url.searchParams.set("tag", this.affiliateTag);
    if (context.campaign) url.searchParams.set("ascsubtag", context.campaign);
    return url.toString();
  }

  private externalIdFor(key: string): string {
    // Amazon ASINs are 10 alphanumeric chars starting with B0 in practice.
    const seed = seededInt(`amazon:${key}`, 100000, 999999).toString().padStart(6, "0");
    return `B0${seed}${key.slice(0, 2).toUpperCase()}`;
  }

  private toOffer(entry: (typeof MOCK_CATALOG)[number]): MarketplaceOfferData {
    const externalId = this.externalIdFor(entry.key);
    const priceJitterPct = seededInt(`amazon:price:${entry.key}`, -8, 4);
    const priceCents = Math.round(entry.basePriceCents * (1 + priceJitterPct / 100));
    const hasDiscount = seededInt(`amazon:discount:${entry.key}`, 0, 100) > 40;
    const originalPriceCents = hasDiscount
      ? Math.round(priceCents * (1 + seededInt(`amazon:origpct:${entry.key}`, 10, 35) / 100))
      : undefined;

    return {
      externalId,
      productName: entry.name,
      brand: entry.brand,
      imageUrl: entry.imageUrl,
      category: entry.category,
      description: entry.description,
      url: `https://www.amazon.com.br/dp/${externalId}`,
      sellerName:
        seededInt(`amazon:seller:${entry.key}`, 0, 1) === 0
          ? "Amazon.com.br"
          : `${entry.brand} Store`,
      sellerRating: seededInt(`amazon:rating:${entry.key}`, 78, 99),
      popularityScore: entry.popularityScore,
      priceCents,
      originalPriceCents,
      shippingPriceCents: seededInt(`amazon:shipping:${entry.key}`, 0, 2) === 0 ? 0 : 1_490,
      couponValueCents: 0,
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
      url: `https://www.amazon.com.br/dp/${externalId}`,
      sellerName: "Amazon.com.br",
      sellerRating: seededInt(`amazon:rating:${entry.key}`, 78, 99),
      metadata: { source: "mock", catalogKey: entry.key, slug: slugify(entry.name) },
    };
  }
}

// ---------------------------------------------------------------------------
// Real integration: Amazon Creators API
// ---------------------------------------------------------------------------
//
// RESEARCH NOTE (Sept 2026): the previous real implementation here targeted
// PA-API 5.0, which Amazon has since retired (May 15, 2026) in favor of the
// "Creators API" -- OAuth2 client-credentials auth instead of AWS SigV4, and
// lowerCamelCase request/response fields instead of PascalCase. This class
// was verified directly against Amazon's own Creators API documentation
// (affiliate-program.amazon.com/creatorsapi/docs/en-us/*): the OAuth token
// request, the getItems cURL example, the searchItems request/response
// shape, the Brazil marketplace value, getItems response envelope, and the
// full offersV2 resource shape are confirmed in those docs. Keep the returned
// detailPageURL intact: Amazon warns that altering a vended link can remove
// Associate attribution. Verify the real account's tag and destination before
// launch.

/** Credentials for a real Amazon Creators API integration. */
export interface AmazonCreatorsApiCredentials {
  /** OAuth2 client id, issued when registering for the Creators API (distinct from old PA-API keys). */
  clientId: string;
  /** OAuth2 client secret paired with `clientId`. */
  clientSecret: string;
  /** Associate/partner tracking tag -- sent as `partnerTag` and validated on API-vended URLs. */
  affiliateTag: string;
}

const CREATORS_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const CREATORS_API_BASE = "https://creatorsapi.amazon/catalog/v1";
const CREATORS_MARKETPLACE = "www.amazon.com.br";
const CREATORS_SCOPE = "creatorsapi::default";
/** Amazon-documented token lifetime; refresh a little early to avoid racing expiry mid-request. */
const TOKEN_TTL_SECONDS = 3600;
const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60_000;
const CREATORS_MAX_ITEM_COUNT = 10;
const CREATORS_MAX_TOTAL_ITEMS = 30;
const CREATORS_MAX_RETRIES = 3;
const CREATORS_RETRY_BASE_DELAY_MS = 300;
const CREATORS_DEFAULT_SEARCH_KEYWORDS = "ofertas";

const CREATORS_ITEM_RESOURCES = [
  "images.primary.large",
  "itemInfo.title",
  "itemInfo.byLineInfo",
  "offersV2",
];

interface CreatorsTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface CreatorsMoney {
  amount?: number;
  currency?: string;
  displayAmount?: string;
}

interface CreatorsAvailability {
  type?: string;
  message?: string;
}

interface CreatorsListing {
  price?: { money?: CreatorsMoney; savingBasis?: { money?: CreatorsMoney } };
  availability?: CreatorsAvailability;
  merchantInfo?: { name?: string };
}

interface CreatorsItem {
  asin: string;
  detailPageURL?: string;
  itemInfo?: {
    title?: { displayValue?: string };
    byLineInfo?: { brand?: { displayValue?: string } };
  };
  images?: { primary?: { large?: { url?: string } } };
  offersV2?: { listings?: CreatorsListing[] };
}

interface CreatorsErrorBody {
  errors?: { code?: string; message?: string }[];
  message?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Maps Creators API's `offersV2.listings[].availability.type` onto this codebase's `Availability` enum. */
function mapAvailability(type?: string): Availability {
  switch (type) {
    case "IN_STOCK":
      return "in_stock";
    case "IN_STOCK_SCARCE":
      return "low_stock";
    case "OUT_OF_STOCK":
    case "UNAVAILABLE":
      return "out_of_stock";
    default:
      return "unknown";
  }
}

/**
 * Real Amazon Creators API-backed provider. Auth is OAuth2 client-credentials
 * (no signing library needed -- just a token fetch, unlike the old PA-API's
 * hand-rolled AWS SigV4). The access token is cached in memory and re-minted
 * automatically shortly before it expires.
 */
export class AmazonCreatorsApiProvider implements MarketplaceProvider {
  readonly marketplace = "amazon_br" as const;

  private cachedToken: { value: string; expiresAt: number } | undefined;
  private tokenRefreshPromise: Promise<string> | undefined;

  constructor(private readonly credentials: AmazonCreatorsApiCredentials) {}

  async fetchOffers(options: FetchOffersOptions = {}): Promise<MarketplaceOfferData[]> {
    const targetCount = Math.min(
      Math.max(options.limit ?? CREATORS_MAX_ITEM_COUNT, 1),
      CREATORS_MAX_TOTAL_ITEMS,
    );
    const maxPages = Math.ceil(CREATORS_MAX_TOTAL_ITEMS / CREATORS_MAX_ITEM_COUNT);
    const items: CreatorsItem[] = [];
    let page = 1;

    while (items.length < targetCount && page <= maxPages) {
      const pageSize = Math.min(CREATORS_MAX_ITEM_COUNT, targetCount - items.length);
      const body = (await this.execute("/searchItems", {
        keywords: options.category?.trim() || CREATORS_DEFAULT_SEARCH_KEYWORDS,
        partnerTag: this.credentials.affiliateTag,
        marketplace: CREATORS_MARKETPLACE,
        itemCount: pageSize,
        itemPage: page,
        resources: CREATORS_ITEM_RESOURCES,
      })) as { searchResult?: { items?: CreatorsItem[] } };

      const pageItems = body.searchResult?.items ?? [];
      items.push(...pageItems);
      if (pageItems.length < pageSize) break; // no more results to page through
      page += 1;
    }

    const offers: MarketplaceOfferData[] = [];
    for (const item of items) {
      const offer = this.toOfferData(item);
      if (offer) offers.push(offer);
    }
    return offers;
  }

  async getProduct(externalId: string): Promise<MarketplaceProductData | null> {
    const body = (await this.execute("/getItems", {
      itemIds: [externalId],
      itemIdType: "ASIN",
      partnerTag: this.credentials.affiliateTag,
      marketplace: CREATORS_MARKETPLACE,
      resources: CREATORS_ITEM_RESOURCES,
    })) as { itemsResult?: { items?: CreatorsItem[] } };

    const item = body.itemsResult?.items?.[0];
    if (!item) {
      throw new Error(`Creators API getItems returned no item for externalId "${externalId}"`);
    }
    return this.toProductData(item);
  }

  async buildAffiliateUrl(
    product: MarketplaceProductData,
    _context: AffiliateContext = {},
  ): Promise<string> {
    if (!this.isValidVendedDetailPageUrl(product.url)) {
      throw new Error("Amazon Creators API product is missing its valid vended affiliate URL");
    }
    // Channel attribution is recorded by our /go redirect row; don't mutate
    // Amazon's vended link or any of its query parameters.
    return product.url;
  }

  private toOfferData(item: CreatorsItem): MarketplaceOfferData | null {
    const url = this.vendedDetailPageUrl(item);
    if (!url) return null;

    const listing = item.offersV2?.listings?.[0];
    const amount = listing?.price?.money?.amount;
    const currency = listing?.price?.money?.currency;
    if (
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      (currency !== undefined && currency !== "BRL")
    ) {
      // No purchasable listing on this item right now -- skip rather than
      // fabricate a price or score a non-BRL amount as if it were reais.
      return null;
    }

    const savingBasisAmount = listing?.price?.savingBasis?.money?.amount;
    const savingBasisCurrency = listing?.price?.savingBasis?.money?.currency;
    const originalPriceCents =
      typeof savingBasisAmount === "number" &&
      Number.isFinite(savingBasisAmount) &&
      savingBasisAmount > amount &&
      (savingBasisCurrency === undefined || savingBasisCurrency === (currency ?? "BRL"))
        ? toCents(savingBasisAmount)
        : undefined;

    return {
      externalId: item.asin,
      productName: item.itemInfo?.title?.displayValue ?? item.asin,
      brand: item.itemInfo?.byLineInfo?.brand?.displayValue,
      imageUrl: item.images?.primary?.large?.url,
      url,
      sellerName: listing?.merchantInfo?.name,
      // Creators API doesn't expose a seller rating or a popularity/demand
      // score in directly usable form -- omitted rather than fabricated.
      priceCents: toCents(amount),
      originalPriceCents,
      currency: currency ?? "BRL",
      availability: mapAvailability(listing?.availability?.type),
      capturedAt: new Date(),
      metadata: { source: "creatorsapi", asin: item.asin },
    };
  }

  private toProductData(item: CreatorsItem): MarketplaceProductData {
    const url = this.vendedDetailPageUrl(item);
    if (!url) {
      throw new Error(`Amazon Creators API item "${item.asin}" has no valid vended affiliate URL`);
    }

    return {
      externalId: item.asin,
      productName: item.itemInfo?.title?.displayValue ?? item.asin,
      brand: item.itemInfo?.byLineInfo?.brand?.displayValue,
      imageUrl: item.images?.primary?.large?.url,
      url,
      sellerName: item.offersV2?.listings?.[0]?.merchantInfo?.name,
      metadata: { source: "creatorsapi", asin: item.asin },
    };
  }

  private vendedDetailPageUrl(item: CreatorsItem): string | undefined {
    if (!item.detailPageURL || !this.isValidVendedDetailPageUrl(item.detailPageURL)) {
      return undefined;
    }
    return item.detailPageURL;
  }

  private isValidVendedDetailPageUrl(rawUrl: string): boolean {
    try {
      const url = new URL(rawUrl);
      const host = url.hostname.toLowerCase();
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        (host === "amazon.com.br" || host === "www.amazon.com.br") &&
        url.searchParams.get("tag") === this.credentials.affiliateTag
      );
    } catch {
      return false;
    }
  }

  /** Returns a cached access token, refreshing it if absent/near expiry. De-dupes concurrent refreshes. */
  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.value;
    }
    if (this.tokenRefreshPromise) return this.tokenRefreshPromise;

    this.tokenRefreshPromise = (async () => {
      const response = await fetch(CREATORS_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
          scope: CREATORS_SCOPE,
        }),
        signal: providerRequestSignal(),
      });

      const body = (await response.json().catch(() => undefined)) as
        | CreatorsTokenResponse
        | undefined;

      if (!response.ok || !body?.access_token) {
        throw new Error(
          `Amazon Creators API token request failed: HTTP ${response.status} ${body?.error_description ?? body?.error ?? ""}`.trim(),
        );
      }

      this.cachedToken = {
        value: body.access_token,
        expiresAt:
          Date.now() +
          (body.expires_in ?? TOKEN_TTL_SECONDS) * 1000 -
          TOKEN_EXPIRY_SAFETY_MARGIN_MS,
      };
      return this.cachedToken.value;
    })();

    try {
      return await this.tokenRefreshPromise;
    } finally {
      this.tokenRefreshPromise = undefined;
    }
  }

  /** Sends one Creators API request, retrying HTTP 429 with exponential backoff. */
  private async execute(path: string, body: Record<string, unknown>): Promise<unknown> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= CREATORS_MAX_RETRIES; attempt++) {
      const token = await this.getAccessToken();
      let response: Response;
      try {
        response = await fetch(`${CREATORS_API_BASE}${path}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-marketplace": CREATORS_MARKETPLACE,
          },
          body: JSON.stringify(body),
          signal: providerRequestSignal(),
        });
      } catch (error) {
        throw new Error(
          `Amazon Creators API ${path} request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (response.ok) return response.json();

      const errorBody = (await response.json().catch(() => undefined)) as
        | CreatorsErrorBody
        | undefined;
      const primary = errorBody?.errors?.[0];
      lastError = new Error(
        `Amazon Creators API ${path} error [${primary?.code ?? response.status}]: ${primary?.message ?? errorBody?.message ?? response.statusText}`,
      );

      if (response.status === 429 && attempt < CREATORS_MAX_RETRIES) {
        await delay(CREATORS_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }

      throw lastError;
    }

    throw (
      lastError ??
      new Error(`Amazon Creators API ${path} request failed after ${CREATORS_MAX_RETRIES} attempts`)
    );
  }
}

/**
 * Factory mirroring `createTelegramPublisher`'s credential-driven fallback
 * shape: returns a real `AmazonCreatorsApiProvider` when `clientId`,
 * `clientSecret`, and the marketplace Partner Tag are supplied. If the OAuth
 * pair is present without a tag, it fails fast instead of using an unrelated
 * default; when the OAuth pair is absent it falls back to the deterministic
 * mock so startup, seeding, and tests never require real credentials.
 */
export function createAmazonProvider(options: {
  affiliateTag?: string;
  creatorsClientId?: string;
  creatorsClientSecret?: string;
}): MarketplaceProvider {
  if (options.creatorsClientId && options.creatorsClientSecret) {
    if (!options.affiliateTag?.trim()) {
      throw new Error("AMAZON_AFFILIATE_TAG is required for the Amazon Creators API provider");
    }
    return new AmazonCreatorsApiProvider({
      clientId: options.creatorsClientId,
      clientSecret: options.creatorsClientSecret,
      affiliateTag: options.affiliateTag,
    });
  }
  return new AmazonBrazilProvider(options.affiliateTag);
}
