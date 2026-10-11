// Run by GitHub Actions on a schedule (.github/workflows/collect.yml).
// Locally: `npm run collect` (or `npm run collect:dry` to only print).
import { runCollect } from "../collect.ts";
import { loadConfig } from "../config.ts";
import { createNodeDb } from "../db-node.ts";

const dryRun = process.argv.includes("--dry-run");
const cfg = loadConfig(process.env);
const db = createNodeDb(cfg.databaseUrl);
try {
  const result = await runCollect(cfg, db, {}, { dryRun });
  console.log(JSON.stringify(result, null, 2));
  // Fail the GitHub run only when nothing worked, so you get an email.
  if (result.errors.length && result.previews === 0 && result.found === 0) process.exitCode = 1;
} finally {
  await db.close();
}
