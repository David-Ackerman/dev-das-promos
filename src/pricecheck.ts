import type { Config } from "./config.ts";
import { fetchProductPage } from "./manual.ts";
import { fetchShopeeItem } from "./providers/shopee.ts";
import type { PostRow } from "./types.ts";
import { errorMessage } from "./util.ts";

/**
 * Re-reads a product's price right before it is published (and later, to flag
 * deals that ended). Runs in the Worker and in GitHub Actions: fetch only.
 * "unknown" never blocks anything: a check that fails must not stop a post.
 */
export type PriceVerdict = "same" | "lower" | "higher" | "gone" | "unknown";

export interface PriceCheck {
  verdict: PriceVerdict;
  priceCents?: number;
  originalPriceCents?: number;
  detail?: string;
}

/** 2% either way is noise (rounding, Pix vs card), not a price change. */
export function comparePrice(oldCents: number, newCents: number): "same" | "lower" | "higher" {
  if (newCents > oldCents * 1.02) return "higher";
  if (newCents < oldCents * 0.98) return "lower";
  return "same";
}

export async function checkPrice(cfg: Config, post: PostRow): Promise<PriceCheck> {
  try {
    if (post.marketplace === "shopee") {
      if (!cfg.shopee) return { verdict: "unknown", detail: "Shopee keys not set" };
      const item = await fetchShopeeItem(cfg.shopee, post.external_id);
      if (item === undefined) return { verdict: "gone" };
      if (item === null) return { verdict: "unknown", detail: "no price in Shopee's answer" };
      return {
        verdict: comparePrice(post.price_cents, item.priceCents),
        priceCents: item.priceCents,
        originalPriceCents: item.originalPriceCents,
      };
    }
    const { page, error } = await fetchProductPage(post.affiliate_url);
    if (error === "HTTP 404") return { verdict: "gone" };
    if (!page.priceCents) return { verdict: "unknown", detail: error ?? "no price on the page" };
    return {
      verdict: comparePrice(post.price_cents, page.priceCents),
      priceCents: page.priceCents,
      originalPriceCents: page.originalPriceCents,
    };
  } catch (error) {
    return { verdict: "unknown", detail: errorMessage(error) };
  }
}
