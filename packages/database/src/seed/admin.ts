import { hashPassword } from "@dev-das-promos/shared";
import { sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { adminUsers } from "../schema/index.js";

export async function seedAdminUser(db: Database): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase() || "admin@example.com";
  const password = process.env.ADMIN_PASSWORD || "change-me-please";

  const existing = await db
    .select()
    .from(adminUsers)
    .where(sql`lower(${adminUsers.email}) = ${email}`);
  if (existing.length > 0) return;

  await db.insert(adminUsers).values({
    email,
    passwordHash: await hashPassword(password),
    name: "Admin",
  });
}
