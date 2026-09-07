import { MOCK_CATALOG } from "@dev-das-promos/providers";
import { slugify } from "@dev-das-promos/shared";
import type { Database } from "../client.js";
import { products } from "../schema/index.js";

export interface SeededProduct {
  productId: string;
  catalogKey: string;
  slug: string;
  name: string;
  categoryId: string | undefined;
  popularityScore: number;
}

export async function seedProducts(
  db: Database,
  categoryIdByName: Map<string, string>,
): Promise<SeededProduct[]> {
  const seeded: SeededProduct[] = [];

  for (const entry of MOCK_CATALOG) {
    const slug = slugify(entry.name);
    const [row] = await db
      .insert(products)
      .values({
        name: entry.name,
        slug,
        brand: entry.brand,
        categoryId: categoryIdByName.get(entry.category),
        imageUrl: entry.imageUrl,
        description: entry.description,
        metadata: { catalogKey: entry.key, popularityScore: entry.popularityScore },
      })
      .returning();

    if (row) {
      seeded.push({
        productId: row.id,
        catalogKey: entry.key,
        slug,
        name: entry.name,
        categoryId: categoryIdByName.get(entry.category),
        popularityScore: entry.popularityScore,
      });
    }
  }

  return seeded;
}
