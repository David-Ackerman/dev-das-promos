import type { Redis } from "@dev-das-promos/queue";

/**
 * Gates how many AI-generated (OpenRouter) posts get created per UTC day,
 * so the platform stays comfortably inside a free-tier request cap
 * without needing a paid plan. Backed by Redis so the count survives
 * process restarts and is shared correctly if content generation ever
 * runs in more than one process (see docs/architecture.md's "modular
 * monolith" note on splitting workers out later). Takes the same `Redis`
 * connection the BullMQ workers already hold (see
 * apps/api/src/server.ts's `workerConnection`) rather than opening a new
 * one -- BullMQ's own `Queue.client` getter deliberately exposes a
 * minimal adapter interface (no raw `incr`/`expire`), so this needs the
 * underlying connection directly, not the one Queue instances wrap.
 *
 * Always increments unconditionally and compares the result to `limit`:
 * a call that turns out to be over quota still "spent" a counter slot,
 * which is fine -- the counter only needs to gate future calls
 * correctly, there's nothing to give back.
 */
export async function reserveDailyAiContentSlot(redis: Redis, limit: number): Promise<boolean> {
  const key = `ai-content:daily-count:${utcDateKey(new Date())}`;

  const count = await redis.incr(key);
  if (count === 1) {
    // Safety-net TTL well past a day, in case a clock skew or a missed
    // key ever left an orphaned counter -- it always self-heals.
    await redis.expire(key, 60 * 60 * 48);
  }

  return count <= limit;
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}
