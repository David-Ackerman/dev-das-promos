import { type Database, createDatabase } from "@dev-das-promos/database";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
  }
}

export default fp(async function dbPlugin(fastify: FastifyInstance) {
  const db = createDatabase(env.DATABASE_URL);
  fastify.decorate("db", db);

  fastify.addHook("onClose", async () => {
    await db.$client.end();
  });
});
