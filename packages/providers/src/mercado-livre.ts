import { slugify, toCents } from "@dev-das-promos/shared";
import type { Availability } from "@dev-das-promos/shared";
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
 * real official API implementation is MercadoLivreApiProvider below;
 * createMercadoLivreProvider selects it when its OAuth credentials are
 * present. There is no legitimate unofficial API for Mercado Livre data.
 */
export class MercadoLivreProvider implements MarketplaceProvider {
  readonly marketplace = "mercado_livre" as const;

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
    url.searchParams.set("matt_word", this.affiliateId);
    if (context.campaign) url.searchParams.set("matt_tool", context.campaign);
    if (context.subId) url.searchParams.set("forceInApp", context.subId);
    return url.toString();
  }

  private externalIdFor(key: string): string {
    // Mercado Livre item ids are "MLB" + digits for the Brazil site in practice.
    return `MLB${seededInt(`mercado_livre:${key}`, 1_000_000_000, 4_999_999_999)}`;
  }

  private toOffer(entry: (typeof MOCK_CATALOG)[number]): MarketplaceOfferData {
    const externalId = this.externalIdFor(entry.key);
    const priceJitterPct = seededInt(`mercado_livre:price:${entry.key}`, -10, 6);
    const priceCents = Math.round(entry.basePriceCents * (1 + priceJitterPct / 100));
    const hasDiscount = seededInt(`mercado_livre:discount:${entry.key}`, 0, 100) > 45;
    const originalPriceCents = hasDiscount
      ? Math.round(priceCents * (1 + seededInt(`mercado_livre:origpct:${entry.key}`, 10, 30) / 100))
      : undefined;

    return {
      externalId,
      productName: entry.name,
      brand: entry.brand,
      imageUrl: entry.imageUrl,
      category: entry.category,
      description: entry.description,
      url: `https://produto.mercadolivre.com.br/${externalId}`,
      sellerName:
        seededInt(`mercado_livre:seller:${entry.key}`, 0, 1) === 0
          ? "Mercado Livre Full"
          : `${entry.brand} Oficial`,
      sellerRating: seededInt(`mercado_livre:rating:${entry.key}`, 70, 99),
      popularityScore: Math.max(
        0,
        entry.popularityScore - seededInt(`mercado_livre:pop:${entry.key}`, 0, 8),
      ),
      priceCents,
      originalPriceCents,
      shippingPriceCents: seededInt(`mercado_livre:shipping:${entry.key}`, 0, 2) === 0 ? 0 : 1_290,
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
      url: `https://produto.mercadolivre.com.br/${externalId}`,
      sellerName: "Mercado Livre Full",
      sellerRating: seededInt(`mercado_livre:rating:${entry.key}`, 70, 99),
      metadata: { source: "mock", catalogKey: entry.key, slug: slugify(entry.name) },
    };
  }
}

// ---------------------------------------------------------------------------
// Real API-backed provider
// ---------------------------------------------------------------------------

const ML_API_BASE = "https://api.mercadolibre.com";
/** ML access tokens are typically valid ~6h (21600s); refresh a little early. */
const DEFAULT_TOKEN_TTL_SECONDS = 21_600;
const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface MLTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
  message?: string;
}

interface MLSellerReputation {
  level_id?: string | null;
  power_seller_status?: string | null;
}

interface MLSearchItem {
  id: string;
  title: string;
  price: number;
  original_price?: number | null;
  currency_id?: string;
  thumbnail?: string;
  permalink?: string;
  category_id?: string;
  available_quantity?: number;
  sold_quantity?: number;
  condition?: string;
  status?: string;
  shipping?: { free_shipping?: boolean };
  seller?: { id?: number; nickname?: string; seller_reputation?: MLSellerReputation };
}

interface MLSearchResponse {
  results?: MLSearchItem[];
}

interface MLItem {
  id: string;
  title: string;
  price: number;
  original_price?: number | null;
  currency_id?: string;
  thumbnail?: string;
  pictures?: Array<{ url?: string }>;
  permalink?: string;
  category_id?: string;
  available_quantity?: number;
  sold_quantity?: number;
  condition?: string;
  status?: string;
  shipping?: { free_shipping?: boolean };
  seller_id?: number;
}

interface MLUser {
  id: number;
  nickname?: string;
  seller_reputation?: MLSellerReputation;
}

/**
 * Maps Mercado Livre's `seller_reputation.level_id` (documented values:
 * "5_green", "4_light_green", "3_yellow", "2_orange", "1_red", or absent
 * for a seller with no reputation history yet) onto this codebase's 0-100
 * `sellerRating` scale. Returns undefined when there's nothing meaningful
 * to map, per the "omit rather than fabricate" rule for optional fields.
 */
function mapSellerReputationToRating(
  reputation: MLSellerReputation | undefined,
): number | undefined {
  const levelId = reputation?.level_id;
  if (!levelId) return undefined;
  switch (levelId) {
    case "5_green":
      return 100;
    case "4_light_green":
      return 80;
    case "3_yellow":
      return 60;
    case "2_orange":
      return 40;
    case "1_red":
      return 20;
    default:
      return undefined;
  }
}

/** Maps ML's item `status` + `available_quantity` onto this codebase's Availability enum. */
function mapAvailability(
  status: string | undefined,
  availableQuantity: number | undefined,
): Availability {
  if (status && status !== "active") return "out_of_stock";
  if (availableQuantity === undefined) return "unknown";
  if (availableQuantity <= 0) return "out_of_stock";
  if (availableQuantity <= 5) return "low_stock";
  return "in_stock";
}

/**
 * REAL provider backed by Mercado Livre's official API
 * (`https://api.mercadolibre.com`). Requires an approved ML application
 * (client id + client secret) and a refresh token obtained once, manually,
 * via the OAuth2 authorization-code flow -- see the "Mercado Livre" section
 * of docs/providers.md for the exact one-time setup steps.
 *
 * Token handling: the constructor never makes a network call. Every method
 * that needs to talk to the API first calls `ensureAccessToken()`, which
 * reuses a cached access token until ~60s before its documented `expires_in`
 * (Mercado Livre's tokens live ~6h) and otherwise exchanges the current
 * refresh token for a new one via `POST /oauth/token`
 * (`grant_type=refresh_token`). Mercado Livre *rotates* refresh tokens --
 * every successful refresh-token exchange returns a brand-new refresh token
 * and immediately invalidates the old one -- so the freshly-issued token is
 * cached in memory and reused for the lifetime of this instance/process,
 * and a warning is logged so an operator knows the configured refresh token
 * is now stale. The rotated secret is never written to logs. There is no
 * secure persistence adapter in this provider, so before restarting the
 * process an operator must complete the authorization-code flow again and
 * store the newly issued refresh token in the deployment secret source.
 *
 * Research notes (see docs/providers.md for sources/links):
 * - Search: `GET /sites/MLB/search?q=&category=&limit=&offset=`.
 * - Single item: `GET /items/{id}`.
 * - Seller reputation (used for `sellerRating`): `GET /users/{seller_id}`,
 *   `seller_reputation.level_id`.
 * - Affiliate links: as of this writing Mercado Livre has **no official,
 *   documented, programmatic API to generate affiliate links** -- the
 *   "Programa de Afiliados" (relaunched 2023) issues short links
 *   (`mercadolivre.com.br/sec/...`) only through its web portal
 *   (mercadolivre.com.br/afiliados-home), and the mock's `matt_word`/
 *   `matt_tool` query-param scheme this class's mock sibling uses is a
 *   legacy/best-effort guess that current docs do not confirm still works.
 *   `buildAffiliateUrl` below throws rather than fabricate a link that may
 *   silently fail to attribute commissions -- see that method's docstring.
 */
export class MercadoLivreApiProvider implements MarketplaceProvider {
  readonly marketplace = "mercado_livre" as const;

  private currentRefreshToken: string;
  private accessToken: string | undefined;
  private accessTokenExpiresAt = 0;
  private refreshInFlight: Promise<void> | undefined;

  constructor(
    private readonly appId: string,
    private readonly clientSecret: string,
    refreshToken: string,
    private readonly affiliateId?: string,
  ) {
    this.currentRefreshToken = refreshToken;
  }

  async fetchOffers(options: FetchOffersOptions = {}): Promise<MarketplaceOfferData[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 50);
    const body = await this.authorizedRequest<MLSearchResponse>("/sites/MLB/search", {
      // ML's search endpoint wants either `q` or `category`; fall back to a
      // generic query when no category was requested so the call is valid.
      q: options.category ? undefined : "ofertas",
      category: options.category,
      limit,
    });

    return (body.results ?? []).map((item) => this.toOfferFromSearchItem(item));
  }

  async getProduct(externalId: string): Promise<MarketplaceProductData | null> {
    let item: MLItem;
    try {
      item = await this.authorizedRequest<MLItem>(`/items/${encodeURIComponent(externalId)}`);
    } catch (error) {
      if (error instanceof Error && /404|not_found|item not found/i.test(error.message)) {
        return null;
      }
      throw error;
    }

    const sellerRating = await this.lookupSellerRating(item.seller_id);

    return {
      externalId: item.id,
      productName: item.title,
      imageUrl: item.thumbnail ?? item.pictures?.[0]?.url,
      category: item.category_id,
      url: item.permalink ?? `https://produto.mercadolivre.com.br/${item.id}`,
      sellerName: undefined,
      sellerRating,
      metadata: { source: "mercado_livre_api", condition: item.condition, status: item.status },
    };
  }

  /**
   * Mercado Livre has no official, documented API for programmatically
   * generating affiliate links (confirmed against current developer-portal
   * and affiliate-program documentation while building this provider --
   * see docs/providers.md). The "Programa de Afiliados" only issues
   * tracked short links (`mercadolivre.com.br/sec/...`) through its web
   * portal, one product at a time, by a logged-in human. There is no
   * verified query-param scheme (the mock's `matt_word`/`matt_tool`
   * params are an unverified legacy guess) and no API endpoint to call
   * here. Throwing -- rather than emitting an untracked/broken link -- is
   * the deliberate choice; a real deployment needs a pre-generated
   * link lookup (e.g. a table mapping externalId -> portal-generated
   * short link, refreshed manually) wired in ahead of this call.
   */
  async buildAffiliateUrl(
    product: MarketplaceProductData,
    _context: AffiliateContext = {},
  ): Promise<string> {
    throw new Error(
      `Mercado Livre does not expose a public API for programmatic affiliate-link generation. Affiliate links must be created manually through the Affiliate Portal (https://www.mercadolivre.com.br/afiliados-home) for each product and stored/looked up separately -- see the "Mercado Livre" section of docs/providers.md. Product: ${product.url} (externalId: ${product.externalId})`,
    );
  }

  // -- internals -------------------------------------------------------

  private async lookupSellerRating(sellerId: number | undefined): Promise<number | undefined> {
    if (!sellerId) return undefined;
    try {
      const user = await this.authorizedRequest<MLUser>(`/users/${sellerId}`);
      return mapSellerReputationToRating(user.seller_reputation);
    } catch {
      // Reputation is a non-critical enrichment -- omit rather than fail the whole lookup.
      return undefined;
    }
  }

  private toOfferFromSearchItem(item: MLSearchItem): MarketplaceOfferData {
    const priceCents = toCents(item.price);
    const originalPriceCents =
      typeof item.original_price === "number" && item.original_price > item.price
        ? toCents(item.original_price)
        : undefined;

    return {
      externalId: item.id,
      productName: item.title,
      imageUrl: item.thumbnail,
      category: item.category_id,
      url: item.permalink ?? `https://produto.mercadolivre.com.br/${item.id}`,
      sellerName: item.seller?.nickname,
      sellerRating: mapSellerReputationToRating(item.seller?.seller_reputation),
      priceCents,
      originalPriceCents,
      shippingPriceCents: item.shipping?.free_shipping ? 0 : undefined,
      couponValueCents: 0,
      currency: item.currency_id ?? "BRL",
      availability: mapAvailability(item.status, item.available_quantity),
      capturedAt: new Date(),
      metadata: { source: "mercado_livre_api", condition: item.condition },
    };
  }

  private async ensureAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.accessTokenExpiresAt - TOKEN_EXPIRY_SAFETY_MARGIN_MS) {
      return this.accessToken;
    }
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refreshAccessToken().finally(() => {
        this.refreshInFlight = undefined;
      });
    }
    await this.refreshInFlight;
    if (!this.accessToken) {
      throw new Error("Mercado Livre: failed to obtain an access token after refresh.");
    }
    return this.accessToken;
  }

  private async refreshAccessToken(): Promise<void> {
    const response = await fetch(`${ML_API_BASE}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.appId,
        client_secret: this.clientSecret,
        refresh_token: this.currentRefreshToken,
      }),
      signal: providerRequestSignal(),
    });

    const body = (await response.json().catch(() => ({}))) as MLTokenResponse;

    if (!response.ok || !body.access_token) {
      const description = body.error_description ?? body.message ?? `HTTP ${response.status}`;
      if (response.status === 400 || body.error === "invalid_grant") {
        throw new Error(
          `Mercado Livre refresh token is invalid or expired -- a new one must be obtained via the manual OAuth authorization flow, see docs/providers.md. (${description})`,
        );
      }
      throw new Error(`Mercado Livre OAuth token refresh failed: ${description}`);
    }

    this.accessToken = body.access_token;
    this.accessTokenExpiresAt = Date.now() + (body.expires_in ?? DEFAULT_TOKEN_TTL_SECONDS) * 1000;

    if (body.refresh_token && body.refresh_token !== this.currentRefreshToken) {
      this.currentRefreshToken = body.refresh_token;
      // Mercado Livre rotates refresh tokens on every use; the old one is now
      // invalid. Keep the new one in-process, but never expose credentials
      // in logs. There is no secure persistence adapter in this provider.
      console.warn(
        "[mercado-livre] Refresh token rotated by Mercado Livre's OAuth server. The new token is held in memory only; before restarting, complete the authorization-code flow again and update the deployment secret.",
      );
    }
  }

  private async authorizedRequest<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = new URL(`${ML_API_BASE}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const accessToken = await this.ensureAccessToken();
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
        signal: providerRequestSignal(),
      });

      if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
        lastError = new Error(`Mercado Livre API returned HTTP ${response.status} for ${path}`);
        await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        const description =
          (body as { message?: string; error?: string }).message ??
          (body as { message?: string; error?: string }).error ??
          `HTTP ${response.status}`;
        throw new Error(`Mercado Livre API error for ${path}: ${description}`);
      }

      return body as T;
    }

    throw (
      lastError ??
      new Error(`Mercado Livre API request to ${path} failed after ${MAX_ATTEMPTS} attempts.`)
    );
  }
}

/**
 * Factory mirroring `createTelegramPublisher`'s shape: returns the real,
 * API-backed provider only when all three credentials are present, and
 * falls back to the deterministic mock otherwise so local dev/CI/seed
 * never require live Mercado Livre credentials.
 */
export function createMercadoLivreProvider(
  options: {
    affiliateId?: string;
    appId?: string;
    clientSecret?: string;
    refreshToken?: string;
  } = {},
): MarketplaceProvider {
  if (options.appId && options.clientSecret && options.refreshToken) {
    return new MercadoLivreApiProvider(
      options.appId,
      options.clientSecret,
      options.refreshToken,
      options.affiliateId,
    );
  }
  return new MercadoLivreProvider(options.affiliateId);
}
