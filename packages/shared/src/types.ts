import { z } from "zod";

export const marketplaceSchema = z.enum(["amazon_br", "shopee_br", "mercado_livre"]);
export type Marketplace = z.infer<typeof marketplaceSchema>;

export const publicationChannelSchema = z.enum(["telegram", "x", "web"]);
export type PublicationChannel = z.infer<typeof publicationChannelSchema>;

export const dealCandidateStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "auto_approved",
  "published",
  "expired",
]);
export type DealCandidateStatus = z.infer<typeof dealCandidateStatusSchema>;

export const publicationStatusSchema = z.enum(["queued", "publishing", "published", "failed"]);
export type PublicationStatus = z.infer<typeof publicationStatusSchema>;

export const availabilitySchema = z.enum(["in_stock", "low_stock", "out_of_stock", "unknown"]);
export type Availability = z.infer<typeof availabilitySchema>;

/** Discriminates whether a monetization estimate is a rough default or backed by observed data. */
export const estimateBasisSchema = z.enum(["heuristic", "historical"]);
export type EstimateBasis = z.infer<typeof estimateBasisSchema>;

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
