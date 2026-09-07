import { index, pgTable, text, unique } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./columns.js";
import { dealCandidates } from "./deal-candidate.js";
import { publicationChannelEnum } from "./enums.js";

/**
 * Internal short-link record backing GET /go/:code. The destination
 * affiliate URL is resolved server-side from `destinationUrl`; the
 * redirect handler NEVER accepts an arbitrary destination from the
 * request, which is what prevents this from becoming an open redirect.
 */
export const redirects = pgTable(
  "redirects",
  {
    id: idColumn(),
    code: text("code").notNull(),
    dealCandidateId: text("deal_candidate_id")
      .notNull()
      .references(() => dealCandidates.id, { onDelete: "cascade" }),
    destinationUrl: text("destination_url").notNull(),
    channel: publicationChannelEnum("channel"),
    campaign: text("campaign"),
    source: text("source"),
    ...timestamps,
  },
  (table) => [
    unique("redirects_code_unique").on(table.code),
    index("redirects_deal_idx").on(table.dealCandidateId),
  ],
);

export type Redirect = typeof redirects.$inferSelect;
export type NewRedirect = typeof redirects.$inferInsert;
