import { index, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./columns.js";
import { dealCandidates } from "./deal-candidate.js";
import { publicationChannelEnum, publicationStatusEnum } from "./enums.js";

/**
 * Tracks a deal's publication to one channel. Channel is a plain enum
 * today (telegram/x/web); adding whatsapp/threads/email later is a
 * migration + enum value + a new Publisher implementation, not a schema
 * redesign (see packages/affiliate publisher interface).
 */
export const publications = pgTable(
  "publications",
  {
    id: idColumn(),
    dealCandidateId: text("deal_candidate_id")
      .notNull()
      .references(() => dealCandidates.id, { onDelete: "cascade" }),
    channel: publicationChannelEnum("channel").notNull(),
    externalPublicationId: text("external_publication_id"),
    status: publicationStatusEnum("status").notNull().default("queued"),
    /** The rendered content that was (or will be) published to this channel. */
    content: text("content"),
    errorMessage: text("error_message"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    unique("publications_deal_channel_unique").on(table.dealCandidateId, table.channel),
    index("publications_status_idx").on(table.status),
  ],
);

export type Publication = typeof publications.$inferSelect;
export type NewPublication = typeof publications.$inferInsert;
