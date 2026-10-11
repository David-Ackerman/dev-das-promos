import { type MarketplaceOfferData, createProviderRegistry } from "@dev-das-promos/providers";
import type { Marketplace } from "@dev-das-promos/shared";
import type { Database } from "../client.js";
import { marketplaceProducts } from "../schema/index.js";
import type { SeededProduct } from "./products.js";

export interface SeededMarketplaceProduct {
  marketplaceProductId: string;
  productId: string;
  catalogKey: string;
  marketplace: Marketplace;
  /** The mock provider's current offer for this listing, reused to seed the latest price observation. */
  offer: MarketplaceOfferData;
}

const MARKETPLACES: Marketplace[] = ["amazon_br", "shopee_br", "mercado_livre"];

export async function seedMarketplaceProducts(
  db: Database,
  seededProducts: SeededProduct[],
): Promise<SeededMarketplaceProduct[]> {
  const productByCatalogKey = new Map(seededProducts.map((p) => [p.catalogKey, p]));
  const registry = createProviderRegistry({
    amazonAffiliateTag: process.env.AMAZON_AFFILIATE_TAG || "dasdeals-20",
    shopeeAffiliateId: process.env.SHOPEE_AFFILIATE_ID || "dasdeals",
    mercadoLivreAffiliateId: process.env.MERCADO_LIVRE_AFFILIATE_ID || "dasdeals",
  });

  const results: SeededMarketplaceProduct[] = [];

  for (const marketplace of MARKETPLACES) {
    const provider = registry[marketplace];
    const offers = await provider.fetchOffers();

    for (const offer of offers) {
      const catalogKey = offer.metadata?.catalogKey as string | undefined;
      if (!catalogKey) continue;
      const product = productByCatalogKey.get(catalogKey);
      if (!product) continue;

      const [row] = await db
        .insert(marketplaceProducts)
        .values({
          productId: product.productId,
          marketplace,
          externalId: offer.externalId,
          url: offer.url,
          sellerName: offer.sellerName,
          sellerRating: offer.sellerRating,
          metadata: { source: "mock", catalogKey },
        })
        .returning();

      if (row) {
        results.push({
          marketplaceProductId: row.id,
          productId: product.productId,
          catalogKey,
          marketplace,
          offer,
        });
      }
    }
  }

  return results;
}
