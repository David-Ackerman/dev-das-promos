import type { Redis } from "ioredis";
import { afterEach, describe, expect, it } from "vitest";
import { createRedisConnection } from "../connection.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

describe("createRedisConnection", () => {
  let connection: Redis | undefined;

  afterEach(async () => {
    connection?.disconnect();
    connection = undefined;
  });

  it("connects to the real local Redis and responds to ping", async () => {
    connection = createRedisConnection(REDIS_URL);
    const result = await connection.ping();
    expect(result).toBe("PONG");
  });

  it("is constructed with maxRetriesPerRequest: null, as BullMQ requires", () => {
    connection = createRedisConnection(REDIS_URL);
    expect(connection.options.maxRetriesPerRequest).toBeNull();
  });
});
