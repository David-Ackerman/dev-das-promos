import { pgEnum } from "drizzle-orm/pg-core";

export const marketplaceEnum = pgEnum("marketplace", ["amazon_br", "shopee_br", "mercado_livre"]);

export const availabilityEnum = pgEnum("availability", [
  "in_stock",
  "low_stock",
  "out_of_stock",
  "unknown",
]);

export const dealCandidateStatusEnum = pgEnum("deal_candidate_status", [
  "pending",
  "approved",
  "rejected",
  "auto_approved",
  "published",
  "expired",
]);

export const publicationChannelEnum = pgEnum("publication_channel", ["telegram", "x", "web"]);

export const publicationStatusEnum = pgEnum("publication_status", [
  "queued",
  "publishing",
  "published",
  "failed",
]);

export const estimateBasisEnum = pgEnum("estimate_basis", ["heuristic", "historical"]);
