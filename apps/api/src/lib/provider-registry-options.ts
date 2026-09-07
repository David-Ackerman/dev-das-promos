import type { Env } from "@dev-das-promos/config";
import type { ProviderRegistryOptions } from "@dev-das-promos/providers";

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
