import { type AnyPgColumn, index, pgTable, text, unique } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./columns.js";

/** Self-referencing hierarchy: Gaming > PC Hardware > Peripherals, etc. */
export const categories = pgTable(
  "categories",
  {
    id: idColumn(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    parentId: text("parent_id").references((): AnyPgColumn => categories.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    unique("categories_slug_unique").on(table.slug),
    index("categories_parent_idx").on(table.parentId),
  ],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
