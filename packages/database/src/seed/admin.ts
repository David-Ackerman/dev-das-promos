import { hashPassword } from "@dev-das-promos/shared";
import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { adminUsers } from "../schema/index.js";

export async function seedAdminUser(db: Database): Promise<void> {
  const email = process.env.ADMIN_EMAIL || "admin@example.com";
  const password = process.env.ADMIN_PASSWORD || "change-me-please";

  const existing = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
  if (existing.length > 0) return;

  await db.insert(adminUsers).values({
    email,
    passwordHash: await hashPassword(password),
    name: "Admin",
  });
}
