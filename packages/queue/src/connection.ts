import IORedis, { type Redis } from "ioredis";

export type { Redis };

/** BullMQ requires maxRetriesPerRequest: null on the shared connection. */
export function createRedisConnection(redisUrl: string): Redis {
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}
