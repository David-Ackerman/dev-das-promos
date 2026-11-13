/**
 * Store key. The search runs on the three with APIs; links the admin sends can
 * be from any store, keyed by its web address ("kabum", "magalu", "aliexpress"…).
 * Display names: `storeName` in render.ts.
 */
export type Marketplace = "amazon" | "shopee" | "mercadolivre" | "aliexpress" | (string & {});
export type Channel = "telegram" | "whatsapp" | "x" | "web";

/** A discount coupon the admin sends with /cupom. Money in cents; every field comes from the admin, never the AI. */
export interface Coupon {
  /** What to type at checkout; absent for coupons you "pick up" on the link. */
  code?: string;
  pctOff?: number;
  centsOff?: number;
  /** Free-text discount when it isn't a plain % or R$ ("frete grátis", "leve 3 pague 2"). */
  discountText?: string;
  minCents?: number;
  maxCents?: number;
  /** ISO time it stops working (end of the day in Brasília when only a date was given). */
  validUntil?: string;
  rules: string[];
  /** Store name the admin typed ("loja: …"), shown instead of the one from the link. */
  store?: string;
}

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
  /** Set for coupons: the AI writes a call to use the coupon instead of a product line. */
  coupon?: Coupon;
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
  /** Short product name shown in the posts; null = the title. */
  short_title?: string | null;
  ai_model: string | null;
  preview_chat_id: string | null;
  preview_message_id: string | number | null;
  preview_has_photo: boolean;
  /** ISO time a queued post goes out; null when not queued. */
  scheduled_at: string | null;
  /** The admin typed the price: the price check leaves it alone. */
  price_from_admin: boolean;
  /** "deal" (a product) or "coupon" (/cupom: no product price, see `coupon`). */
  kind: "deal" | "coupon";
  coupon: Coupon | null;
  /** ISO time a coupon stops working; null when unknown or for deals. */
  valid_until: string | null;
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
