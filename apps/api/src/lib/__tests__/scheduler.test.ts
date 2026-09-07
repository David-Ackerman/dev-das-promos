import {
  type QueueBundle,
  type Redis,
  closeQueues,
  createQueues,
  createRedisConnection,
} from "@dev-das-promos/queue";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMinutesToTimeOfDay,
  parseTimeOfDay,
  registerScheduledJobs,
  scheduleConfigFromEnv,
} from "../scheduler.js";

describe("parseTimeOfDay", () => {
  it("parses a well-formed HH:mm time", () => {
    expect(parseTimeOfDay("09:00")).toEqual({ hour: 9, minute: 0 });
    expect(parseTimeOfDay("23:59")).toEqual({ hour: 23, minute: 59 });
  });

  it("throws on a malformed time", () => {
    expect(() => parseTimeOfDay("9:00")).toThrow(/Invalid time/);
    expect(() => parseTimeOfDay("not-a-time")).toThrow(/Invalid time/);
  });

  it("throws when hour or minute is out of range", () => {
    expect(() => parseTimeOfDay("24:00")).toThrow(/out of range/);
    expect(() => parseTimeOfDay("09:60")).toThrow(/out of range/);
  });
});

describe("addMinutesToTimeOfDay", () => {
  it("adds minutes within the same day", () => {
    expect(addMinutesToTimeOfDay("09:00", 15)).toEqual({ hour: 9, minute: 15 });
  });

  it("rolls over the hour", () => {
    expect(addMinutesToTimeOfDay("09:50", 15)).toEqual({ hour: 10, minute: 5 });
  });

  it("wraps around midnight", () => {
    expect(addMinutesToTimeOfDay("23:50", 15)).toEqual({ hour: 0, minute: 5 });
  });
});

describe("scheduleConfigFromEnv", () => {
  it("parses comma-separated times and marketplaces", () => {
    const config = scheduleConfigFromEnv({
      SCHEDULE_TIMES: "09:00, 13:00 ,17:00",
      SCHEDULE_MARKETPLACES: "shopee_br, mercado_livre",
      SCHEDULE_PUBLISH_DELAY_MINUTES: 10,
      SCHEDULE_PUBLISH_LIMIT: 3,
    });

    expect(config.times).toEqual(["09:00", "13:00", "17:00"]);
    expect(config.marketplaces).toEqual(["shopee_br", "mercado_livre"]);
    expect(config.publishDelayMinutes).toBe(10);
    expect(config.publishLimit).toBe(3);
  });
});

describe("registerScheduledJobs", () => {
  const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
  let connection: Redis;
  let queues: QueueBundle;

  beforeAll(() => {
    connection = createRedisConnection(REDIS_URL);
    queues = createQueues(connection);
  });

  afterAll(async () => {
    // Clean up every job scheduler this test registered so it doesn't
    // leave real scheduled ingestion/publish jobs firing against the
    // shared local dev Redis after the test run.
    for (const queue of [queues.offerIngestion, queues.scheduledPublish]) {
      const schedulers = await queue.getJobSchedulers();
      for (const scheduler of schedulers) {
        if (scheduler.key.startsWith("scheduled-")) {
          await queue.removeJobScheduler(scheduler.key);
        }
      }
    }
    await closeQueues(queues);
    connection.disconnect();
  });

  it("registers one ingestion job scheduler per marketplace per time, and one publish scheduler per time", async () => {
    await registerScheduledJobs(queues, {
      times: ["09:00", "13:00"],
      marketplaces: ["shopee_br", "mercado_livre"],
      publishDelayMinutes: 15,
      publishLimit: 5,
    });

    const ingestionSchedulers = await queues.offerIngestion.getJobSchedulers();
    const scheduledIngestion = ingestionSchedulers.filter((s) =>
      s.key.startsWith("scheduled-ingest-"),
    );
    expect(scheduledIngestion).toHaveLength(4); // 2 marketplaces x 2 times

    const publishSchedulers = await queues.scheduledPublish.getJobSchedulers();
    const scheduledPublishSchedulers = publishSchedulers.filter((s) =>
      s.key.startsWith("scheduled-publish-"),
    );
    expect(scheduledPublishSchedulers).toHaveLength(2); // 1 per time

    // 09:00 + 15min publish trigger.
    const nineAmPublish = scheduledPublishSchedulers.find(
      (s) => s.key === "scheduled-publish-09:00",
    );
    expect(nineAmPublish?.pattern).toBe("15 9 * * *");
  });

  it("is idempotent -- calling it again does not duplicate schedules", async () => {
    await registerScheduledJobs(queues, {
      times: ["09:00", "13:00"],
      marketplaces: ["shopee_br", "mercado_livre"],
      publishDelayMinutes: 15,
      publishLimit: 5,
    });

    const ingestionSchedulers = await queues.offerIngestion.getJobSchedulers();
    expect(ingestionSchedulers.filter((s) => s.key.startsWith("scheduled-ingest-"))).toHaveLength(
      4,
    );
  });
});
