import {
  type QueueBundle,
  closeQueues,
  createQueues,
  createRedisConnection,
} from "@dev-das-promos/queue";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.js";

declare module "fastify" {
  interface FastifyInstance {
    queues: QueueBundle;
  }
}

export default fp(async function queuesPlugin(fastify: FastifyInstance) {
  const connection = createRedisConnection(env.REDIS_URL);
  const queues = createQueues(connection);
  fastify.decorate("queues", queues);

  fastify.addHook("onClose", async () => {
    await closeQueues(queues);
    connection.disconnect();
  });
});
