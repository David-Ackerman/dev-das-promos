import type { Marketplace } from "@dev-das-promos/shared";

export function requiresManualAffiliateLink(marketplace: Marketplace, nodeEnv: string): boolean {
  return nodeEnv === "production" && marketplace === "mercado_livre";
}

export function affiliateLinkSupportError(marketplace: Marketplace): string {
  return marketplace === "mercado_livre"
    ? "Mercado Livre affiliate links must be created manually; automated publishing is unavailable for this marketplace"
    : `Affiliate link generation is unavailable for ${marketplace}`;
}
