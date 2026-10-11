import type { Marketplace } from "@dev-das-promos/shared";
import { createAmazonProvider } from "./amazon-br.js";
import { createMercadoLivreProvider } from "./mercado-livre.js";
import { createShopeeProvider } from "./shopee-br.js";
import type { MarketplaceProvider } from "./types.js";

export interface ProviderRegistryOptions {
  amazonAffiliateTag?: string;
  shopeeAffiliateId?: string;
  mercadoLivreAffiliateId?: string;

  /** Amazon Creators API credentials. Real provider also requires the marketplace Partner Tag. */
  amazonCreatorsClientId?: string;
  amazonCreatorsClientSecret?: string;

  /** Shopee Affiliate Open API credentials. Real provider used only when both are set. */
  shopeeAppId?: string;
  shopeeAppSecret?: string;

  /** Mercado Livre OAuth2 app credentials. Real provider used only when all three are set. */
  mercadoLivreAppId?: string;
  mercadoLivreClientSecret?: string;
  mercadoLivreRefreshToken?: string;
}

/**
 * Central factory so callers (ingestion pipeline, admin re-fetch action,
 * n8n-triggered internal endpoints) never `new` a concrete provider
 * directly. Adding a marketplace = add a case here + implement
 * MarketplaceProvider.
 *
 * Each `create<X>Provider` call falls back to the deterministic mock
 * provider when its real-mode credentials are absent -- so callers that
 * only ever pass the affiliate tag/id (e.g. the database seed script)
 * transparently stay on mock data, and callers that pass the full real
 * credential set (env-driven, in apps/api) transparently get real data.
 */
export function createProviderRegistry(
  options: ProviderRegistryOptions = {},
): Record<Marketplace, MarketplaceProvider> {
  return {
    amazon_br: createAmazonProvider({
      affiliateTag: options.amazonAffiliateTag,
      creatorsClientId: options.amazonCreatorsClientId,
      creatorsClientSecret: options.amazonCreatorsClientSecret,
    }),
    shopee_br: createShopeeProvider({
      affiliateId: options.shopeeAffiliateId,
      appId: options.shopeeAppId,
      appSecret: options.shopeeAppSecret,
    }),
    mercado_livre: createMercadoLivreProvider({
      affiliateId: options.mercadoLivreAffiliateId,
      appId: options.mercadoLivreAppId,
      clientSecret: options.mercadoLivreClientSecret,
      refreshToken: options.mercadoLivreRefreshToken,
    }),
  };
}

export function getProvider(
  marketplace: Marketplace,
  options: ProviderRegistryOptions = {},
): MarketplaceProvider {
  const registry = createProviderRegistry(options);
  const provider = registry[marketplace];
  if (!provider) {
    throw new Error(`No provider registered for marketplace "${marketplace}"`);
  }
  return provider;
}
