import { z } from "zod";

/**
 * Deal-engine weights and approval thresholds live here (config), NOT
 * hard-coded inside packages/deal-engine, so they can be tuned per
 * environment/category without touching scoring logic or redeploying
 * business rules as code changes.
 */
export const dealScoreWeightsSchema = z.object({
  historicalDiscount: z.number().min(0).max(1),
  discount: z.number().min(0).max(1),
  commission: z.number().min(0).max(1),
  seller: z.number().min(0).max(1),
  popularity: z.number().min(0).max(1),
  conversion: z.number().min(0).max(1),
  freshness: z.number().min(0).max(1),
});

export type DealScoreWeights = z.infer<typeof dealScoreWeightsSchema>;

export const DEFAULT_DEAL_SCORE_WEIGHTS: DealScoreWeights = {
  historicalDiscount: 0.3,
  discount: 0.2,
  commission: 0.15,
  seller: 0.1,
  popularity: 0.1,
  conversion: 0.1,
  freshness: 0.05,
};

export const approvalThresholdsSchema = z.object({
  autoApproveMinScore: z.number().min(0).max(100),
  humanReviewMinScore: z.number().min(0).max(100),
});

export type ApprovalThresholds = z.infer<typeof approvalThresholdsSchema>;

/**
 * score >= autoApproveMinScore            -> auto_approved
 * humanReviewMinScore <= score < autoApproveMinScore -> pending (human review)
 * score < humanReviewMinScore              -> rejected
 */
export const DEFAULT_APPROVAL_THRESHOLDS: ApprovalThresholds = {
  autoApproveMinScore: 90,
  humanReviewMinScore: 70,
};

export const scoreLabelSchema = z.object({
  minScore: z.number().min(0).max(100),
  label: z.string(),
});

export type ScoreLabel = z.infer<typeof scoreLabelSchema>;

/** Ordered highest -> lowest; first matching threshold wins. */
export const DEFAULT_SCORE_LABELS: ScoreLabel[] = [
  { minScore: 90, label: "Exceptional deal" },
  { minScore: 80, label: "Great deal" },
  { minScore: 70, label: "Good deal" },
  { minScore: 50, label: "Average" },
  { minScore: 0, label: "Weak deal" },
];

export function getScoreLabel(score: number, labels: ScoreLabel[] = DEFAULT_SCORE_LABELS): string {
  const sorted = [...labels].sort((a, b) => b.minScore - a.minScore);
  for (const entry of sorted) {
    if (score >= entry.minScore) return entry.label;
  }
  return sorted.at(-1)?.label ?? "Unrated";
}
