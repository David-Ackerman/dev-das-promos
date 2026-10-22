export type Marketplace = "amazon" | "shopee" | "mercadolivre";
export type Channel = "telegram" | "whatsapp" | "x" | "web";

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
  /** The admin typed the price: the price check leaves it alone. */
  price_from_admin: boolean;
  // joined from products
  marketplace: Marketplace;
  external_id: string;
  title: string;
  /** The post's own photo (/img/<id>) when it has one, else the store photo. */
  image_url: string | null;
  /** Always the store's photo (products.image_url). */
  store_image_url?: string | null;
  /** "generated" = AI scene; null = store photo. */
  image_source?: string | null;
  /** Why the photo is what it is (shown to the admin in the preview). */
  image_note?: string | null;
  product_url: string;
}
