import { neon } from "@neondatabase/serverless";
import { type Config, loadConfig } from "./config.ts";
import type { Db } from "./db.ts";
import { createHandler } from "./http.ts";

/** Cloudflare Worker entry: wires the HTTP handler (src/http.ts) to Neon over HTTP. */
function neonDb(url: string): Db {
  const sql = neon(url);
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.query(text, params)) as T[];
    },
  };
}

let cached: { key: string; deps: { cfg: Config; db: Db } } | undefined;

export default createHandler((env) => {
  const key = env.DATABASE_URL ?? "";
  if (!cached || cached.key !== key) {
    const cfg = loadConfig(env);
    cached = { key, deps: { cfg, db: neonDb(cfg.databaseUrl) } };
  }
  return cached.deps;
});
