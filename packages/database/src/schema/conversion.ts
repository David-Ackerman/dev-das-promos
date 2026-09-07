import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./columns.js";
import { dealCandidates } from "./deal-candidate.js";
import { marketplaceEnum } from "./enums.js";

/**
 * Real conversion attribution import is out of scope for this MVP (no
 * marketplace grants API access to raw order data without an approved
 * affiliate integration). This table's shape is designed so a future
 * import job (Amazon Associates reports, Shopee affiliate reports) can
 * populate it without a schema change; seed data mocks a few rows so
 * analytics has something real to aggregate today.
 */
export const conversions = pgTable(
  "conversions",
  {
    id: idColumn(),
    marketplace: marketplaceEnum("marketplace").notNull(),
    dealCandidateId: text("deal_candidate_id").references(() => dealCandidates.id, {
      onDelete: "set null",
    }),
    orderReference: text("order_reference").notNull(),
    revenueCents: integer("revenue_cents").notNull(),
    commissionCents: integer("commission_cents").notNull(),
    currency: text("currency").notNull().default("BRL"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    index("conversions_deal_idx").on(table.dealCandidateId),
    index("conversions_occurred_idx").on(table.occurredAt),
  ],
);

export type Conversion = typeof conversions.$inferSelect;
export type NewConversion = typeof conversions.$inferInsert;
