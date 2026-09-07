import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { afterEach, describe, expect, it } from "vitest";
import { createRedisConnection } from "../connection.js";
import { QUEUE_NAMES } from "../queue-names.js";
import { type QueueBundle, closeQueues, createQueues } from "../queues.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

describe("createQueues / closeQueues", () => {
  let connection: Redis | undefined;
  let queues: QueueBundle | undefined;

  afterEach(async () => {
    if (queues) {
      await closeQueues(queues);
      queues = undefined;
    }
    connection?.disconnect();
    connection = undefined;
  });

  it("creates a bundle with all 6 expected BullMQ queues, correctly named", () => {
    connection = createRedisConnection(REDIS_URL);
    queues = createQueues(connection);

    expect(Object.keys(queues)).toHaveLength(6);

    expect(queues.offerIngestion).toBeInstanceOf(Queue);
    expect(queues.offerIngestion.name).toBe(QUEUE_NAMES.offerIngestion);

    expect(queues.dealEvaluation).toBeInstanceOf(Queue);
    expect(queues.dealEvaluation.name).toBe(QUEUE_NAMES.dealEvaluation);

    expect(queues.contentGeneration).toBeInstanceOf(Queue);
    expect(queues.contentGeneration.name).toBe(QUEUE_NAMES.contentGeneration);

    expect(queues.publication).toBeInstanceOf(Queue);
    expect(queues.publication.name).toBe(QUEUE_NAMES.publication);

    expect(queues.analyticsProcessing).toBeInstanceOf(Queue);
    expect(queues.analyticsProcessing.name).toBe(QUEUE_NAMES.analyticsProcessing);

    expect(queues.scheduledPublish).toBeInstanceOf(Queue);
    expect(queues.scheduledPublish.name).toBe(QUEUE_NAMES.scheduledPublish);
  });

  it("closes all queues without throwing", async () => {
    connection = createRedisConnection(REDIS_URL);
    queues = createQueues(connection);

    await expect(closeQueues(queues)).resolves.toBeUndefined();
    queues = undefined;
  });
});
