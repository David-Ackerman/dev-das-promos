import { index, integer, jsonb, pgTable, text, unique } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./columns.js";
import { marketplaceEnum } from "./enums.js";
import { products } from "./product.js";

/** A specific listing of a product at a specific marketplace. */
export const marketplaceProducts = pgTable(
  "marketplace_products",
  {
    id: idColumn(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    marketplace: marketplaceEnum("marketplace").notNull(),
    /** The marketplace's own product/listing identifier (ASIN, item id, ...). */
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    sellerName: text("seller_name"),
    /** Seller rating normalized to 0-100 for comparability across marketplaces. */
    sellerRating: integer("seller_rating"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    unique("marketplace_products_marketplace_external_unique").on(
      table.marketplace,
      table.externalId,
    ),
    index("marketplace_products_product_idx").on(table.productId),
  ],
);

export type MarketplaceProduct = typeof marketplaceProducts.$inferSelect;
export type NewMarketplaceProduct = typeof marketplaceProducts.$inferInsert;
