import { type Database, categories } from "@dev-das-promos/database";
import { eq } from "drizzle-orm";
import { categorySlugCandidates, sameCatalogName } from "../lib/catalog-identity.js";

/** Finds a category by slug, creating a top-level one if missing. */
export async function findOrCreateCategory(db: Database, name: string): Promise<string> {
  const slugs = categorySlugCandidates(name);

  for (const slug of slugs) {
    const [existing] = await db.select().from(categories).where(eq(categories.slug, slug));
    if (existing) {
      if (sameCatalogName(existing.name, name)) return existing.id;
      continue;
    }

    const [created] = await db
      .insert(categories)
      .values({ name, slug })
      .onConflictDoNothing({ target: categories.slug })
      .returning();
    if (created) return created.id;

    const [concurrent] = await db.select().from(categories).where(eq(categories.slug, slug));
    if (concurrent && sameCatalogName(concurrent.name, name)) {
      return concurrent.id;
    }
  }

  throw new Error(`Failed to create category "${name}"`);
}
