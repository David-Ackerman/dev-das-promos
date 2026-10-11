import {
  dealCandidates,
  marketplaceProducts,
  offers,
  publications,
} from "@dev-das-promos/database";
import type { Availability } from "@dev-das-promos/shared";
import { gte, lte, ne, sql } from "drizzle-orm";

export const MAX_OFFER_AGE_MS = 72 * 60 * 60 * 1000;
const PUBLISHABLE_DEAL_STATUSES = ["approved", "auto_approved", "published"] as const;

export function isPublishableDealStatus(status: string) {
  return PUBLISHABLE_DEAL_STATUSES.some((publishableStatus) => publishableStatus === status);
}

export function isOfferCurrent(availability: Availability, capturedAt: Date, now = new Date()) {
  return (
    availability !== "out_of_stock" &&
    capturedAt.getTime() >= now.getTime() - MAX_OFFER_AGE_MS &&
    capturedAt.getTime() <= now.getTime()
  );
}

export function currentOfferConditions(now = new Date()) {
  return [
    ne(offers.availability, "out_of_stock"),
    gte(offers.capturedAt, new Date(now.getTime() - MAX_OFFER_AGE_MS)),
    lte(offers.capturedAt, now),
  ];
}

/** Excludes explicitly demo-seeded listings from production surfaces. */
export function nonMockMarketplaceProductCondition() {
  return sql`coalesce(${marketplaceProducts.metadata}->>'source' = 'mock', false) = false and not (${marketplaceProducts.metadata} ? 'catalogKey')`;
}

/** Public web listings need a successful web publication for the current offer snapshot. */
export function publishedWebPublicationCondition() {
  return sql`exists (
    select 1 from ${publications}
    where ${publications.dealCandidateId} = ${dealCandidates.id}
      and ${publications.channel} = 'web'
      and ${publications.status} = 'published'
      and ${publications.metadata}->>'offerId' = ${offers.id}
  )`;
}
