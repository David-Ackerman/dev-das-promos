import {
  type QueueBundle,
  type Redis,
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
    redis: Redis;
  }
}

export default fp(async function queuesPlugin(fastify: FastifyInstance) {
  const connection = createRedisConnection(env.REDIS_URL);
  const queues = createQueues(connection);
  fastify.decorate("queues", queues);
  fastify.decorate("redis", connection);

  fastify.addHook("onClose", async () => {
    await closeQueues(queues);
    connection.disconnect();
  });
});
