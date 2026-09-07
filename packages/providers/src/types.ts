import type { Availability, Marketplace } from "@dev-das-promos/shared";

export interface FetchOffersOptions {
  category?: string;
  limit?: number;
  cursor?: string;
}

/** One offer as returned by a marketplace provider, pre-normalization. */
export interface MarketplaceOfferData {
  externalId: string;
  productName: string;
  brand?: string;
  imageUrl?: string;
  /** Human-readable category name; ingestion maps this onto our category tree. */
  category?: string;
  description?: string;
  url: string;
  sellerName?: string;
  /** Normalized 0-100. */
  sellerRating?: number;
  /** Normalized 0-100 popularity/demand proxy (sales rank, review volume, ...). */
  popularityScore?: number;
  priceCents: number;
  originalPriceCents?: number;
  shippingPriceCents?: number;
  couponValueCents?: number;
  currency: string;
  availability: Availability;
  capturedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface MarketplaceProductData {
  externalId: string;
  productName: string;
  brand?: string;
  imageUrl?: string;
  category?: string;
  description?: string;
  url: string;
  sellerName?: string;
  sellerRating?: number;
  metadata?: Record<string, unknown>;
}

export interface AffiliateContext {
  campaign?: string;
  /** Sub-id / click-id forwarded to the marketplace for attribution, when supported. */
  subId?: string;
}

/**
 * Common contract every marketplace integration implements. This is the
 * ONLY thing the ingestion pipeline depends on -- it never imports a
 * concrete provider directly, so swapping a mock for a real scraper/API
 * client later is a one-file change plus a registry entry.
 *
 * IMPORTANT: real Amazon/Shopee integrations require approved API access
 * or an official partner feed. Do not scrape or call undocumented private
 * APIs. Wherever a real implementation is added, it must go through
 * Amazon's Product Advertising API / Associates feeds and Shopee's Open
 * Platform / Affiliate API respectively.
 */
export interface MarketplaceProvider {
  marketplace: Marketplace;
  fetchOffers(options?: FetchOffersOptions): Promise<MarketplaceOfferData[]>;
  getProduct(externalId: string): Promise<MarketplaceProductData | null>;
  buildAffiliateUrl(product: MarketplaceProductData, context?: AffiliateContext): Promise<string>;
}
