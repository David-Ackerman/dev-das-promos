import { sql } from "drizzle-orm";
import type { Database } from "../client.js";

/**
 * Truncates every domain table so `pnpm db:seed` is safely re-runnable.
 * Admin users are intentionally NOT wiped, so re-seeding never invalidates
 * an operator's existing session/credentials.
 */
export async function resetDatabase(db: Database): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      click_events,
      conversions,
      redirects,
      publications,
      deal_candidates,
      offers,
      marketplace_products,
      affiliate_programs,
      products,
      categories
    RESTART IDENTITY CASCADE
  `);
}
