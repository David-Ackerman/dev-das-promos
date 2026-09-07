import { index, jsonb, pgTable, text, unique } from "drizzle-orm/pg-core";
import { categories } from "./category.js";
import { idColumn, timestamps } from "./columns.js";

/** The logical product, independent of any single marketplace listing. */
export const products = pgTable(
  "products",
  {
    id: idColumn(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    brand: text("brand"),
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    imageUrl: text("image_url"),
    description: text("description"),
    /** Free-form marketplace-agnostic attributes (specs, color, etc). */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    unique("products_slug_unique").on(table.slug),
    index("products_category_idx").on(table.categoryId),
  ],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
