import type { Marketplace, PublicationChannel } from "@dev-das-promos/shared";

export type AnalyticsDimension = "channel" | "marketplace" | "category" | "deal" | "date";

export interface AnalyticsFilters {
  from?: Date;
  to?: Date;
  channel?: PublicationChannel;
  marketplace?: Marketplace;
  categoryId?: string;
  dealCandidateId?: string;
}

export interface ClickAggregateRow {
  key: string;
  label: string;
  clicks: number;
}

export interface ConversionAggregateRow {
  key: string;
  label: string;
  conversions: number;
  revenueCents: number;
  commissionCents: number;
}

export interface AnalyticsGroupRow {
  key: string;
  label: string;
  clicks: number;
  conversions: number;
  revenueCents: number;
  commissionCents: number;
  /** conversions / clicks. Undefined when there are no clicks to divide by. */
  conversionRate: number | undefined;
  /** commissionCents / clicks -- earnings per click, the platform's real, measured EPC. */
  epcCents: number | undefined;
}

export interface DashboardTotals {
  totalDeals: number;
  approvedDeals: number;
  publishedDeals: number;
  clicks: number;
  conversions: number;
  revenueCents: number;
  commissionCents: number;
  conversionRate: number | undefined;
  epcCents: number | undefined;
}
