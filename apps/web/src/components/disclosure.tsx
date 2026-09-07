import { DISCLOSURE_TEXT } from "@dev-das-promos/config";

/**
 * Affiliate disclosure, shown wherever a deal or price is shown. We never
 * hide the affiliate relationship -- see docs/architecture.md "Affiliate
 * disclosure".
 */
export function Disclosure() {
  return <p className="text-xs text-neutral-500">{DISCLOSURE_TEXT.web}</p>;
}
