import { type Database, dealCandidates } from "@dev-das-promos/database";
import { eq } from "drizzle-orm";
import { evaluateOffer } from "./deal-evaluation.js";

export async function approveDeal(db: Database, dealCandidateId: string, reviewerEmail: string) {
  const [updated] = await db
    .update(dealCandidates)
    .set({ status: "approved", reviewedBy: reviewerEmail, reviewedAt: new Date() })
    .where(eq(dealCandidates.id, dealCandidateId))
    .returning();
  return updated ?? null;
}

export async function rejectDeal(db: Database, dealCandidateId: string, reviewerEmail: string) {
  const [updated] = await db
    .update(dealCandidates)
    .set({ status: "rejected", reviewedBy: reviewerEmail, reviewedAt: new Date() })
    .where(eq(dealCandidates.id, dealCandidateId))
    .returning();
  return updated ?? null;
}

/** Recomputes score/status from scratch, discarding any prior human decision. */
export async function reEvaluateDeal(db: Database, dealCandidateId: string) {
  const [deal] = await db
    .select()
    .from(dealCandidates)
    .where(eq(dealCandidates.id, dealCandidateId));
  if (!deal) return null;
  return evaluateOffer(db, deal.offerId, { preserveHumanDecision: false });
}
