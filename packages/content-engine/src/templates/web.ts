import { DISCLOSURE_TEXT } from "@dev-das-promos/config";
import { formatCents } from "../format.js";
import type { DealContentInput } from "../types.js";

const MARKETPLACE_LABEL: Record<string, string> = {
  amazon_br: "Amazon Brasil",
  shopee_br: "Shopee Brasil",
  mercado_livre: "Mercado Livre",
};

/** More descriptive: current price, historical comparison, why the score is what it is, CTA. */
export function renderWebSummary(input: DealContentInput): string {
  const parts: string[] = [];
  const marketplaceLabel = MARKETPLACE_LABEL[input.marketplace] ?? input.marketplace;

  parts.push(
    `${input.productName} está por ${formatCents(input.effectivePriceCents, input.currency)} na ${marketplaceLabel}${
      input.sellerName ? `, vendido por ${input.sellerName}` : ""
    }.`,
  );

  if (input.baselinePriceCents && input.baselineLabel && input.realDiscountPercentage > 0) {
    parts.push(
      `Isso é ${input.realDiscountPercentage.toFixed(0)}% abaixo da ${input.baselineLabel}, de ${formatCents(
        input.baselinePriceCents,
        input.currency,
      )}.`,
    );
  } else {
    parts.push(
      "Ainda não temos histórico de preço suficiente para confirmar o quanto este preço é vantajoso.",
    );
  }

  parts.push(`Nota da oferta: ${input.dealScore.toFixed(0)}/100 (${input.scoreLabel}).`);
  if (input.reasoning) parts.push(input.reasoning);

  parts.push(DISCLOSURE_TEXT.web);

  return parts.join(" ");
}
