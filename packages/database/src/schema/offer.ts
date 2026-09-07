import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./columns.js";
import { availabilityEnum } from "./enums.js";
import { marketplaceProducts } from "./marketplace-product.js";

/**
 * A single price observation for a marketplace listing. This is the raw
 * time series; price-history aggregates (7d/30d/90d averages, minimums)
 * are derived from this table by queries rather than duplicated on write,
 * so they can never drift out of sync with the source observations.
 *
 * All monetary fields are integer cents (see packages/shared/money.ts).
 */
export const offers = pgTable(
  "offers",
  {
    id: idColumn(),
    marketplaceProductId: text("marketplace_product_id")
      .notNull()
      .references(() => marketplaceProducts.id, { onDelete: "cascade" }),
    priceCents: integer("price_cents").notNull(),
    /** Marketplace-advertised "original"/list price, if shown. Never trusted blindly. */
    originalPriceCents: integer("original_price_cents"),
    shippingPriceCents: integer("shipping_price_cents").notNull().default(0),
    couponValueCents: integer("coupon_value_cents").notNull().default(0),
    /** price + shipping - coupon: what the deal engine actually scores against. */
    effectivePriceCents: integer("effective_price_cents").notNull(),
    currency: text("currency").notNull().default("BRL"),
    availability: availabilityEnum("availability").notNull().default("unknown"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    index("offers_marketplace_product_idx").on(table.marketplaceProductId),
    index("offers_captured_at_idx").on(table.capturedAt),
    index("offers_mp_captured_idx").on(table.marketplaceProductId, table.capturedAt),
  ],
);

export type Offer = typeof offers.$inferSelect;
export type NewOffer = typeof offers.$inferInsert;
