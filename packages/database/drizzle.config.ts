import { defineConfig } from "drizzle-kit";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/das_promos";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
