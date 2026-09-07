import { type Redis, createRedisConnection } from "@dev-das-promos/queue";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reserveDailyAiContentSlot } from "../lib/ai-content-quota.js";

// Integration test against the real local dev Redis (see the
// das-promos-local-dev skill / CLAUDE.md test data hygiene notes). This
// touches the SAME key the real app uses for today's date -- that's
// intentional (there's nothing to parameterize around, the key is
// date-derived by design), but it's a plain usage counter, not user
// data, so resetting it around this test run is safe and self-healing.
const TODAY_KEY = `ai-content:daily-count:${new Date().toISOString().slice(0, 10)}`;

describe("reserveDailyAiContentSlot", () => {
  let redis: Redis;

  beforeAll(async () => {
    redis = createRedisConnection(process.env.REDIS_URL ?? "redis://localhost:6379");
    await redis.del(TODAY_KEY);
  });

  afterAll(async () => {
    await redis.del(TODAY_KEY);
    redis.disconnect();
  });

  it("allows calls up to the limit and rejects beyond it", async () => {
    const limit = 3;
    expect(await reserveDailyAiContentSlot(redis, limit)).toBe(true); // 1
    expect(await reserveDailyAiContentSlot(redis, limit)).toBe(true); // 2
    expect(await reserveDailyAiContentSlot(redis, limit)).toBe(true); // 3
    expect(await reserveDailyAiContentSlot(redis, limit)).toBe(false); // 4 -- over
    expect(await reserveDailyAiContentSlot(redis, limit)).toBe(false); // 5 -- still over
  });

  it("sets a TTL on the counter key so it doesn't live forever", async () => {
    await redis.del(TODAY_KEY);
    await reserveDailyAiContentSlot(redis, 10);
    const ttl = await redis.ttl(TODAY_KEY);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60 * 60 * 48);
  });

  it("shares the count across separate calls (same key, same day)", async () => {
    await redis.del(TODAY_KEY);
    await reserveDailyAiContentSlot(redis, 100);
    await reserveDailyAiContentSlot(redis, 100);
    const count = await redis.get(TODAY_KEY);
    expect(count).toBe("2");
  });
});
