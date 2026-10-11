import { DISCLOSURE_TEXT } from "@dev-das-promos/config";
import { formatCents } from "../format.js";
import { type ContentLimits, DEFAULT_CONTENT_LIMITS } from "../limits.js";
import type { DealContentInput } from "../types.js";

/**
 * Short and hook-driven. Builds the fixed parts first (price, link,
 * disclosure -- never truncated), then fits as much of the product name
 * as remains within the configured limit. If the fixed fields alone exceed
 * it, they are kept intact and the publisher refuses the post.
 */
export function renderXContent(
  input: DealContentInput,
  limits: ContentLimits = DEFAULT_CONTENT_LIMITS,
): string {
  const discountTag =
    input.realDiscountPercentage > 0 ? `-${Math.round(input.realDiscountPercentage)}% ` : "";
  const price = formatCents(input.effectivePriceCents, input.currency);
  const suffix = `\n${price} ${discountTag}\n${input.goUrl}\n${DISCLOSURE_TEXT.x}`;

  const availableForName = limits.x - suffix.length - 2; // 2 for the leading emoji + space
  const name =
    availableForName <= 0
      ? ""
      : input.productName.length > availableForName
        ? `${input.productName.slice(0, Math.max(0, availableForName - 1))}…`
        : input.productName;

  return `🔥 ${name}${suffix}`;
}
