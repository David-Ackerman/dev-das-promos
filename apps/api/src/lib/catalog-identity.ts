import { createHash } from "node:crypto";
import { slugify } from "@dev-das-promos/shared";

const COLLISION_SUFFIX_LENGTH = 16;
const MAX_SLUG_LENGTH = 96;

export function normalizeCatalogName(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const fallback = value.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
  return normalized || fallback;
}

export function sameCatalogName(left: string, right: string): boolean {
  return normalizeCatalogName(left) === normalizeCatalogName(right);
}

export function productSlugCandidates(name: string): [string, string] {
  const baseSlug = slugify(name) || "produto";
  const suffix = stableSuffix(normalizeCatalogName(name));
  const disambiguated = appendSuffix(baseSlug, suffix);
  return [baseSlug, disambiguated];
}

export function categorySlugCandidates(name: string): string[] {
  const baseSlug = slugify(name);
  const suffix = stableSuffix(normalizeCatalogName(name));
  if (!baseSlug) return [`categoria-${suffix}`];
  return [baseSlug, appendSuffix(baseSlug, suffix)];
}

function stableSuffix(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, COLLISION_SUFFIX_LENGTH);
}

function appendSuffix(baseSlug: string, suffix: string): string {
  return `${baseSlug.slice(0, MAX_SLUG_LENGTH - suffix.length - 1)}-${suffix}`;
}
