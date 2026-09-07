import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/das_promos";

async function main() {
  const migrationClient = postgres(databaseUrl, { max: 1 });
  const db = drizzle(migrationClient);
  console.log(`Running migrations against ${databaseUrl.replace(/:[^:@]+@/, ":***@")}`);
  await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  console.log("Migrations complete.");
  await migrationClient.end();
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
