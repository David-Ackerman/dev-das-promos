import { type ApprovalThresholds, DEFAULT_APPROVAL_THRESHOLDS } from "@dev-das-promos/config";
import type { DealCandidateStatus } from "@dev-das-promos/shared";

/**
 * score >= autoApproveMinScore                        -> auto_approved
 * humanReviewMinScore <= score < autoApproveMinScore   -> pending (human review)
 * score <  humanReviewMinScore                          -> rejected
 */
export function applyApprovalThresholds(
  score: number,
  thresholds: ApprovalThresholds = DEFAULT_APPROVAL_THRESHOLDS,
): Extract<DealCandidateStatus, "auto_approved" | "pending" | "rejected"> {
  if (score >= thresholds.autoApproveMinScore) return "auto_approved";
  if (score >= thresholds.humanReviewMinScore) return "pending";
  return "rejected";
}
