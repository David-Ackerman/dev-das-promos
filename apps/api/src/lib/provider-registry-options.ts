import type { Env } from "@dev-das-promos/config";
import type { ProviderRegistryOptions } from "@dev-das-promos/providers";
import type { Marketplace } from "@dev-das-promos/shared";

/** True when all values needed for live marketplace requests are configured. */
export function hasRealMarketplaceApiCredentials(env: Env, marketplace: Marketplace): boolean {
  switch (marketplace) {
    case "amazon_br":
      // Creators API requests require a marketplace Partner Tag as well as
      // the OAuth client credentials. Without it, the provider factory's
      // development default could otherwise tag production links incorrectly.
      return Boolean(
        env.AMAZON_CREATORS_CLIENT_ID &&
          env.AMAZON_CREATORS_CLIENT_SECRET &&
          env.AMAZON_AFFILIATE_TAG?.trim(),
      );
    case "shopee_br":
      return Boolean(env.SHOPEE_APP_ID && env.SHOPEE_APP_SECRET);
    case "mercado_livre":
      return Boolean(
        env.MERCADO_LIVRE_APP_ID &&
          env.MERCADO_LIVRE_CLIENT_SECRET &&
          env.MERCADO_LIVRE_REFRESH_TOKEN,
      );
  }
}

/** True when the live provider's data and affiliate-link paths are configured. */
export function hasRealMarketplaceCredentials(env: Env, marketplace: Marketplace): boolean {
  if (!hasRealMarketplaceApiCredentials(env, marketplace)) return false;
  switch (marketplace) {
    case "amazon_br":
      return Boolean(env.AMAZON_AFFILIATE_TAG);
    case "shopee_br":
      // The real Shopee Affiliate Open API generates tracked links from its
      // App ID/Secret. SHOPEE_AFFILIATE_ID is only used by the dev mock's
      // legacy `?af_id=` URL builder, not by the real provider.
      return true;
    case "mercado_livre":
      return Boolean(env.MERCADO_LIVRE_AFFILIATE_ID);
  }
}

export function realMarketplaceCredentialsError(
  marketplace: Marketplace,
  requireAffiliateLink = false,
): string {
  if (requireAffiliateLink) {
    return `Real ${marketplace} API and affiliate-link credentials are required for production publishing`;
  }
  if (marketplace === "amazon_br") {
    return "Amazon Creators API credentials and AMAZON_AFFILIATE_TAG are required for production ingestion";
  }
  return `Real ${marketplace} API credentials are required for production ingestion`;
}

/**
 * Maps env vars onto `ProviderRegistryOptions` once, shared by every call
 * site that builds a provider registry (ingestion, content generation).
 * Each `create<X>Provider` factory falls back to its mock implementation
 * whenever its real-mode fields are absent, so this is safe to call
 * unconditionally regardless of which marketplace credentials are set.
 */
export function providerRegistryOptionsFromEnv(env: Env): ProviderRegistryOptions {
  return {
    amazonAffiliateTag: env.AMAZON_AFFILIATE_TAG,
    shopeeAffiliateId: env.SHOPEE_AFFILIATE_ID,
    mercadoLivreAffiliateId: env.MERCADO_LIVRE_AFFILIATE_ID,
    amazonCreatorsClientId: env.AMAZON_CREATORS_CLIENT_ID,
    amazonCreatorsClientSecret: env.AMAZON_CREATORS_CLIENT_SECRET,
    shopeeAppId: env.SHOPEE_APP_ID,
    shopeeAppSecret: env.SHOPEE_APP_SECRET,
    mercadoLivreAppId: env.MERCADO_LIVRE_APP_ID,
    mercadoLivreClientSecret: env.MERCADO_LIVRE_CLIENT_SECRET,
    mercadoLivreRefreshToken: env.MERCADO_LIVRE_REFRESH_TOKEN,
  };
}
