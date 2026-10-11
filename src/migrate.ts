// Applies new SQL files from /migrations, once each, in name order.
// Never rolls back and never touches existing data. Run on every deploy (src/jobs/migrate.ts).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeDb } from "./db-node.ts";

export async function migrate(databaseUrl: string, log = console.log): Promise<string[]> {
  const dir = fileURLToPath(new URL("../migrations/", import.meta.url));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const db = createNodeDb(databaseUrl);
  const applied: string[] = [];
  try {
    await db.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const done = new Set((await db.query<{ name: string }>(`SELECT name FROM schema_migrations`)).map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      const sqlText = await readFile(join(dir, file), "utf8");
      await db.sql.begin(async (tx) => {
        await tx.unsafe(sqlText);
        await tx.unsafe(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
      });
      log(`applied ${file}`);
      applied.push(file);
    }
    if (!applied.length) log("database is up to date");
  } finally {
    await db.close();
  }
  return applied;
}
