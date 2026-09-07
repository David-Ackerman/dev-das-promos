import { slugify } from "@dev-das-promos/shared";
import type { Database } from "../client.js";
import { categories } from "../schema/index.js";

/** name -> parent name (undefined = top-level). Mirrors the example hierarchy from the brief. */
const CATEGORY_TREE: Record<string, string | undefined> = {
  Gaming: undefined,
  "PC Hardware": "Gaming",
  Peripherals: "Gaming",
  Pets: undefined,
  Home: undefined,
  Smartphones: undefined,
};

export async function seedCategories(db: Database): Promise<Map<string, string>> {
  const idByName = new Map<string, string>();

  // Insert top-level categories first so children can reference their parentId.
  const topLevel = Object.entries(CATEGORY_TREE).filter(([, parent]) => !parent);
  const children = Object.entries(CATEGORY_TREE).filter(([, parent]) => parent);

  for (const [name] of topLevel) {
    const [row] = await db
      .insert(categories)
      .values({ name, slug: slugify(name) })
      .returning();
    if (row) idByName.set(name, row.id);
  }

  for (const [name, parent] of children) {
    const parentId = parent ? idByName.get(parent) : undefined;
    const [row] = await db
      .insert(categories)
      .values({ name, slug: slugify(name), parentId })
      .returning();
    if (row) idByName.set(name, row.id);
  }

  return idByName;
}
