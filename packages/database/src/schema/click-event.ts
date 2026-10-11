import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { idColumn } from "./columns.js";
import { dealCandidates } from "./deal-candidate.js";
import { publicationChannelEnum } from "./enums.js";
import { redirects } from "./redirect.js";

/**
 * Privacy-conscious click tracking: no raw IP, no raw user agent string
 * beyond a coarse device/browser summary, and no referrer path or query
 * string. `ipHash` is a truncated salted hash of the IP (see
 * packages/shared/hash.ts); the original address is not stored. HTTP rate
 * limiting is handled separately by Fastify.
 */
export const clickEvents = pgTable(
  "click_events",
  {
    id: idColumn(),
    redirectId: text("redirect_id")
      .notNull()
      .references(() => redirects.id, { onDelete: "cascade" }),
    dealCandidateId: text("deal_candidate_id")
      .notNull()
      .references(() => dealCandidates.id, { onDelete: "cascade" }),
    channel: publicationChannelEnum("channel"),
    campaign: text("campaign"),
    source: text("source"),
    referrer: text("referrer"),
    userAgentSummary: text("user_agent_summary"),
    ipHash: text("ip_hash"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index("click_events_redirect_idx").on(table.redirectId),
    index("click_events_deal_idx").on(table.dealCandidateId),
    index("click_events_occurred_idx").on(table.occurredAt),
  ],
);

export type ClickEvent = typeof clickEvents.$inferSelect;
export type NewClickEvent = typeof clickEvents.$inferInsert;
