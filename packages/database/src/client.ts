import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10 });
  return drizzle(client, { schema });
}

let sharedDb: Database | undefined;

/** Lazily-created singleton for processes that only ever need one connection pool. */
export function getDb(databaseUrl: string): Database {
  if (!sharedDb) sharedDb = createDatabase(databaseUrl);
  return sharedDb;
}
