import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { categories } from "./category.js";
import { idColumn, timestamps } from "./columns.js";
import { marketplaceEnum } from "./enums.js";

/**
 * Commission rules per marketplace (optionally scoped to a category), so
 * the deal engine never hard-codes commission percentages. Rates are
 * stored as basis points (1/100 of a percent) to stay integer-safe:
 * 850 = 8.50%.
 */
export const affiliatePrograms = pgTable(
  "affiliate_programs",
  {
    id: idColumn(),
    marketplace: marketplaceEnum("marketplace").notNull(),
    /** Null categoryId = default/catch-all rate for the marketplace. */
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    commissionRateBps: integer("commission_rate_bps").notNull(),
    extraCommissionRateBps: integer("extra_commission_rate_bps").notNull().default(0),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    index("affiliate_programs_marketplace_idx").on(table.marketplace),
    index("affiliate_programs_category_idx").on(table.categoryId),
  ],
);

export type AffiliateProgram = typeof affiliatePrograms.$inferSelect;
export type NewAffiliateProgram = typeof affiliatePrograms.$inferInsert;
