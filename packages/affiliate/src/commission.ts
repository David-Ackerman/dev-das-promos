import type { Marketplace } from "@dev-das-promos/shared";

export interface AffiliateProgramLike {
  marketplace: Marketplace;
  categoryId: string | null;
  commissionRateBps: number;
  extraCommissionRateBps: number;
  validFrom: Date;
  validUntil: Date | null;
}

export type CommissionSource = "category" | "default" | "none";

export interface ResolvedCommission {
  /** Fraction, e.g. 0.085 for 8.5%. Includes any extra/bonus commission. */
  rate: number;
  baseRateBps: number;
  extraRateBps: number;
  source: CommissionSource;
}

/**
 * Resolves the commission rate to use for a deal, never hard-coded into
 * deal-engine. Picks the most specific, currently-valid program:
 *   1. A program scoped to the product's category, if one is active.
 *   2. The marketplace's default program (categoryId = null), if active.
 *   3. Otherwise "none" (rate 0) -- the deal engine will flag this via
 *      COMMISSION_RATE_UNKNOWN / a neutral default score.
 *
 * When more than one program of the same specificity is active
 * simultaneously, the one with the latest `validFrom` wins (the most
 * recently configured rate takes precedence).
 */
export function resolveCommissionRate(
  programs: AffiliateProgramLike[],
  params: { marketplace: Marketplace; categoryId?: string | null; at?: Date },
): ResolvedCommission {
  const at = params.at ?? new Date();

  const active = programs.filter(
    (program) =>
      program.marketplace === params.marketplace &&
      program.validFrom <= at &&
      (program.validUntil === null || program.validUntil >= at),
  );

  const categoryMatches =
    params.categoryId != null
      ? active.filter((program) => program.categoryId === params.categoryId)
      : [];
  const defaultMatches = active.filter((program) => program.categoryId === null);

  const pick = (candidates: AffiliateProgramLike[]) =>
    candidates.length === 0
      ? undefined
      : candidates.reduce((latest, current) =>
          current.validFrom > latest.validFrom ? current : latest,
        );

  const categoryWinner = pick(categoryMatches);
  if (categoryWinner) {
    return toResolved(categoryWinner, "category");
  }

  const defaultWinner = pick(defaultMatches);
  if (defaultWinner) {
    return toResolved(defaultWinner, "default");
  }

  return { rate: 0, baseRateBps: 0, extraRateBps: 0, source: "none" };
}

function toResolved(program: AffiliateProgramLike, source: CommissionSource): ResolvedCommission {
  const totalBps = program.commissionRateBps + program.extraCommissionRateBps;
  return {
    rate: totalBps / 10_000,
    baseRateBps: program.commissionRateBps,
    extraRateBps: program.extraCommissionRateBps,
    source,
  };
}
