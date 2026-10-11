import { loadEnv } from "@dev-das-promos/config";
import { createDatabase } from "../client.js";
import { seedAdminUser } from "./admin.js";
import { seedAffiliatePrograms } from "./affiliate-programs.js";
import { seedCategories } from "./categories.js";
import { seedClickEvents } from "./clicks.js";
import { seedConversions } from "./conversions.js";
import { seedDealCandidates } from "./deals.js";
import { seedMarketplaceProducts } from "./marketplace-products.js";
import { seedOffers } from "./offers.js";
import { seedProducts } from "./products.js";
import { seedPublications } from "./publications.js";
import { resetDatabase } from "./reset.js";

async function main() {
  const env = loadEnv();
  if (env.NODE_ENV === "production") {
    throw new Error("Demo seed is disabled in production; use db:bootstrap-admin instead");
  }

  const databaseHost = new URL(env.DATABASE_URL).hostname.toLowerCase();
  const localDatabaseHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);
  if (!localDatabaseHosts.has(databaseHost) && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error(
      "Demo seed refuses a remote database unless ALLOW_DEMO_SEED=true is set explicitly",
    );
  }

  console.log("Seeding database...");
  const db = createDatabase(env.DATABASE_URL);

  try {
    console.log("  - Resetting demo tables");
    await resetDatabase(db);

    console.log("  - Categories");
    const categoryIdByName = await seedCategories(db);

    console.log("  - Products");
    const seededProducts = await seedProducts(db, categoryIdByName);

    console.log("  - Marketplace listings (Amazon BR + Shopee BR, mock providers)");
    const seededMarketplaceProducts = await seedMarketplaceProducts(db, seededProducts);

    console.log("  - Affiliate commission programs");
    await seedAffiliatePrograms(db, categoryIdByName);

    console.log("  - Historical + current price offers");
    const latestOffers = await seedOffers(db, seededMarketplaceProducts);

    console.log("  - Scoring deal candidates with the deal engine");
    const deals = await seedDealCandidates(
      db,
      seededMarketplaceProducts,
      latestOffers,
      seededProducts,
    );

    console.log("  - Publishing top deals (mock Telegram/X/Web publishers + redirects)");
    await seedPublications(db, deals);

    console.log("  - Click events");
    await seedClickEvents(db);

    console.log("  - Mock conversions");
    await seedConversions(db);

    console.log("  - Admin user");
    await seedAdminUser(db);

    const summary = {
      products: seededProducts.length,
      marketplaceListings: seededMarketplaceProducts.length,
      deals: deals.length,
      published: deals.filter((d) => d.status === "published").length,
      pending: deals.filter((d) => d.status === "pending").length,
      rejected: deals.filter((d) => d.status === "rejected").length,
    };
    console.log("Seed complete:", summary);
  } finally {
    await db.$client.end();
  }
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
