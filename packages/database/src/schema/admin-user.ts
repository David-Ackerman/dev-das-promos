import { pgTable, text, unique } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./columns.js";

/**
 * MVP admin auth: a small local table of admin users with argon2 password
 * hashes, backing signed-cookie sessions in apps/api (see
 * apps/api/src/plugins/auth.ts). Deliberately not wired to Auth.js yet —
 * a single-tenant internal admin with one or two operators does not need
 * OAuth/social login complexity today, and this table is compatible with
 * introducing Auth.js later (its adapter would read/write this shape).
 */
export const adminUsers = pgTable(
  "admin_users",
  {
    id: idColumn(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name"),
    ...timestamps,
  },
  (table) => [unique("admin_users_email_unique").on(table.email)],
);

export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;
