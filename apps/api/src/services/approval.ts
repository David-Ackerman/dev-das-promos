import { type Database, dealCandidates } from "@dev-das-promos/database";
import { and, eq, inArray } from "drizzle-orm";
import { evaluateOffer } from "./deal-evaluation.js";

export async function approveDeal(db: Database, dealCandidateId: string, reviewerEmail: string) {
  const [updated] = await db
    .update(dealCandidates)
    .set({ status: "approved", reviewedBy: reviewerEmail, reviewedAt: new Date() })
    .where(
      and(
        eq(dealCandidates.id, dealCandidateId),
        inArray(dealCandidates.status, ["pending", "auto_approved", "rejected"]),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function rejectDeal(db: Database, dealCandidateId: string, reviewerEmail: string) {
  const [updated] = await db
    .update(dealCandidates)
    .set({ status: "rejected", reviewedBy: reviewerEmail, reviewedAt: new Date() })
    .where(
      and(
        eq(dealCandidates.id, dealCandidateId),
        inArray(dealCandidates.status, ["pending", "approved", "auto_approved", "published"]),
      ),
    )
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
