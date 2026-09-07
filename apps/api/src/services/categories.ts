import { type Database, categories } from "@dev-das-promos/database";
import { slugify } from "@dev-das-promos/shared";
import { eq } from "drizzle-orm";

/** Finds a category by name (case-sensitive slug match), creating a top-level one if missing. */
export async function findOrCreateCategory(db: Database, name: string): Promise<string> {
  const slug = slugify(name);

  const [existing] = await db.select().from(categories).where(eq(categories.slug, slug));
  if (existing) return existing.id;

  const [created] = await db.insert(categories).values({ name, slug }).returning();
  if (!created) throw new Error(`Failed to create category "${name}"`);
  return created.id;
}
