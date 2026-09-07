import type { AnalyticsGroupRow, ClickAggregateRow, ConversionAggregateRow } from "./types.js";

/**
 * Pure, DB-independent merge of two independently-aggregated sources
 * (clicks come from click_events, conversions/revenue come from the
 * conversions table) into one row per group key. Kept separate from the
 * SQL layer so the merge logic itself -- which is where off-by-one and
 * divide-by-zero bugs like to hide -- can be unit tested without a
 * database.
 */
export function mergeAnalyticsRows(
  clicks: ClickAggregateRow[],
  conversions: ConversionAggregateRow[],
): AnalyticsGroupRow[] {
  const byKey = new Map<string, AnalyticsGroupRow>();

  for (const click of clicks) {
    byKey.set(click.key, {
      key: click.key,
      label: click.label,
      clicks: click.clicks,
      conversions: 0,
      revenueCents: 0,
      commissionCents: 0,
      conversionRate: undefined,
      epcCents: undefined,
    });
  }

  for (const conversion of conversions) {
    const existing = byKey.get(conversion.key);
    if (existing) {
      existing.conversions += conversion.conversions;
      existing.revenueCents += conversion.revenueCents;
      existing.commissionCents += conversion.commissionCents;
    } else {
      byKey.set(conversion.key, {
        key: conversion.key,
        label: conversion.label,
        clicks: 0,
        conversions: conversion.conversions,
        revenueCents: conversion.revenueCents,
        commissionCents: conversion.commissionCents,
        conversionRate: undefined,
        epcCents: undefined,
      });
    }
  }

  for (const row of byKey.values()) {
    row.conversionRate = row.clicks > 0 ? row.conversions / row.clicks : undefined;
    row.epcCents = row.clicks > 0 ? Math.round(row.commissionCents / row.clicks) : undefined;
  }

  return [...byKey.values()].sort((a, b) => b.clicks - a.clicks);
}
