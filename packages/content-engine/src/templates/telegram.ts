import { DISCLOSURE_TEXT } from "@dev-das-promos/config";
import { formatCents } from "../format.js";
import type { DealContentInput } from "../types.js";

const MARKETPLACE_LABEL: Record<string, string> = {
  amazon_br: "Amazon Brasil",
  shopee_br: "Shopee Brasil",
  mercado_livre: "Mercado Livre",
};

/**
 * Telegram allows the most detail: name, price, historical comparison,
 * score, a short reason, CTA, and the disclosure. Nothing here is
 * fabricated -- every value comes straight from `input`.
 */
export function renderTelegramContent(input: DealContentInput): string {
  const lines: string[] = [];

  lines.push(`🔥 ${input.productName}`);
  if (input.brand) lines.push(`Marca: ${input.brand}`);
  lines.push("");
  lines.push(`💰 Por ${formatCents(input.effectivePriceCents, input.currency)}`);

  if (input.baselinePriceCents && input.baselineLabel) {
    lines.push(
      `📉 ${input.realDiscountPercentage.toFixed(0)}% abaixo da ${input.baselineLabel} (${formatCents(
        input.baselinePriceCents,
        input.currency,
      )})`,
    );
  } else if (input.originalPriceCents) {
    lines.push(
      `📉 ${input.realDiscountPercentage.toFixed(0)}% de desconto (de ${formatCents(
        input.originalPriceCents,
        input.currency,
      )})`,
    );
  }

  lines.push(`⭐ Nota da oferta: ${input.dealScore.toFixed(0)}/100 -- ${input.scoreLabel}`);

  if (input.reasoning) {
    lines.push(`👉 ${input.reasoning}`);
  }

  const marketplaceLabel = MARKETPLACE_LABEL[input.marketplace] ?? input.marketplace;
  lines.push(
    `🏬 ${marketplaceLabel}${input.sellerName ? ` · vendido por ${input.sellerName}` : ""}`,
  );
  lines.push("");
  lines.push(`👉 Ver oferta: ${input.goUrl}`);
  lines.push("");
  lines.push(DISCLOSURE_TEXT.telegram);

  return lines.join("\n");
}
