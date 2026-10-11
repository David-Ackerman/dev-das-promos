export type Marketplace = "amazon" | "shopee";
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
  affiliate_url: string;
  caption: string;
  caption_short: string;
  ai_model: string | null;
  preview_chat_id: string | null;
  preview_message_id: string | number | null;
  preview_has_photo: boolean;
  // joined from products
  marketplace: Marketplace;
  title: string;
  image_url: string | null;
  product_url: string;
}
