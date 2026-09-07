import { randomUUID } from "node:crypto";
import { text, timestamp } from "drizzle-orm/pg-core";

/**
 * Shared column helpers. IDs are app-generated UUIDv4 text columns rather
 * than a Postgres-native uuid + gen_random_uuid() default: this avoids a
 * hard dependency on the pgcrypto extension being enabled on whatever
 * Postgres the platform is deployed to, at negligible cost.
 */
export const idColumn = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
