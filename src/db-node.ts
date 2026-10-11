import postgres from "postgres";
import type { Db } from "./db.ts";

/** TCP connection for Node (GitHub Actions jobs, local scripts, tests). */
export function createNodeDb(url: string): Db & { sql: postgres.Sql; close(): Promise<void> } {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const sql = postgres(url, {
    ssl: local ? false : "require",
    max: 3,
    onnotice: () => {},
  });
  return {
    sql,
    async query<T>(text: string, params: unknown[] = []) {
      const rows = await sql.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
      return rows as unknown as T[];
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
