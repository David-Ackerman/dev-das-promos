import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run database migrations");
  }

  const migrationClient = postgres(databaseUrl, { max: 1 });
  const db = drizzle(migrationClient);
  try {
    console.log("Running database migrations.");
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
    console.log("Migrations complete.");
  } finally {
    await migrationClient.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
