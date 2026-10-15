export type Marketplace = "amazon" | "shopee" | "mercadolivre";
export type Channel = "telegram" | "whatsapp" | "x";

/** A deal found on a marketplace, before we decide to post it. */
export interface Candidate {
  marketplace: Marketplace;
  externalId: string;
  title: string;
  imageUrl?: string;
  /** Plain product page URL (Shopee) or the API-vended affiliate URL (Amazon). */
  productUrl: string;
  priceCents: number;
  originalPriceCents?: number;
  discountPct: number;
  sales?: number;
  rating?: number;
  commissionRate?: number;
}

export interface PostRow {
  id: number;
  product_id: number;
  ref: string;
  status: string;
  price_cents: number;
  original_price_cents: number | null;
  discount_pct: number;
  /** Lowest price seen in the 30 days before the post; null without history. */
  lowest_seen_cents: number | null;
  affiliate_url: string;
  caption: string;
  caption_short: string;
  /** Brand/product hashtag for X, without "#"; null = none. */
  hashtag: string | null;
  ai_model: string | null;
  preview_chat_id: string | null;
  preview_message_id: string | number | null;
  preview_has_photo: boolean;
  /** ISO time a queued post goes out; null when not queued. */
  scheduled_at: string | null;
  // joined from products
  marketplace: Marketplace;
  title: string;
  image_url: string | null;
  product_url: string;
}
