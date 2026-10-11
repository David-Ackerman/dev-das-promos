import { loadEnv } from "@dev-das-promos/config";
import { createDatabase } from "./client.js";
import { seedAdminUser } from "./seed/admin.js";

async function main() {
  const env = loadEnv();
  const db = createDatabase(env.DATABASE_URL);
  try {
    await seedAdminUser(db);
    console.log("Admin account is ready.");
  } finally {
    await db.$client.end();
  }
}

main().catch((error) => {
  console.error("Admin bootstrap failed:", error);
  process.exitCode = 1;
});
