import type { Database } from "../client.js";
import { affiliatePrograms } from "../schema/index.js";

const VALID_FROM = new Date("2026-01-01T00:00:00Z");

export async function seedAffiliatePrograms(
  db: Database,
  categoryIdByName: Map<string, string>,
): Promise<void> {
  const peripherals = categoryIdByName.get("Peripherals");
  const pcHardware = categoryIdByName.get("PC Hardware");
  const smartphones = categoryIdByName.get("Smartphones");

  await db.insert(affiliatePrograms).values([
    // Marketplace-wide defaults.
    {
      marketplace: "amazon_br",
      categoryId: null,
      commissionRateBps: 400,
      extraCommissionRateBps: 0,
      validFrom: VALID_FROM,
    },
    {
      marketplace: "shopee_br",
      categoryId: null,
      commissionRateBps: 300,
      extraCommissionRateBps: 0,
      validFrom: VALID_FROM,
    },
    {
      marketplace: "mercado_livre",
      categoryId: null,
      commissionRateBps: 300,
      extraCommissionRateBps: 0,
      validFrom: VALID_FROM,
    },
    // Category-specific bonus programs (gaming peripherals/hardware pay more on Amazon).
    {
      marketplace: "amazon_br",
      categoryId: peripherals ?? null,
      commissionRateBps: 1000,
      extraCommissionRateBps: 200,
      validFrom: VALID_FROM,
      metadata: { note: "Gaming peripherals promo commission" },
    },
    {
      marketplace: "amazon_br",
      categoryId: pcHardware ?? null,
      commissionRateBps: 900,
      extraCommissionRateBps: 100,
      validFrom: VALID_FROM,
      metadata: { note: "PC hardware promo commission" },
    },
    {
      marketplace: "shopee_br",
      categoryId: smartphones ?? null,
      commissionRateBps: 600,
      extraCommissionRateBps: 0,
      validFrom: VALID_FROM,
    },
  ]);
}
