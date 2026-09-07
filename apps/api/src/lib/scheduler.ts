import type { QueueBundle } from "@dev-das-promos/queue";
import type { Marketplace } from "@dev-das-promos/shared";

export interface ScheduleConfig {
  /** 24h UTC "HH:mm" times to run the routine at, e.g. ["09:00", "13:00", "17:00", "21:00"]. */
  times: string[];
  /** Marketplaces to ingest on each cycle. */
  marketplaces: Marketplace[];
  /** Minutes after each ingestion time to trigger publish-ready-deals, giving evaluation time to finish. */
  publishDelayMinutes: number;
  /** Max deals to publish per scheduled run. */
  publishLimit: number;
}

/** Parses "HH:mm" into a BullMQ/cron-compatible `{minute, hour}` pair. Throws on malformed input. */
export function parseTimeOfDay(time: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (!match) throw new Error(`Invalid time "${time}", expected "HH:mm"`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid time "${time}", hour/minute out of range`);
  return { hour, minute };
}

/** Adds `minutes` to a "HH:mm" time, wrapping around midnight (day boundary is irrelevant for a daily cron). */
export function addMinutesToTimeOfDay(
  time: string,
  minutes: number,
): { hour: number; minute: number } {
  const { hour, minute } = parseTimeOfDay(time);
  const totalMinutes = (((hour * 60 + minute + minutes) % 1440) + 1440) % 1440;
  return { hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60 };
}

function toDailyCron({ hour, minute }: { hour: number; minute: number }): string {
  return `${minute} ${hour} * * *`;
}

function parseMarketplaceList(csv: string): Marketplace[] {
  return csv
    .split(",")
    .map((m) => m.trim())
    .filter((m): m is Marketplace => m.length > 0) as Marketplace[];
}

export function scheduleConfigFromEnv(env: {
  SCHEDULE_TIMES: string;
  SCHEDULE_MARKETPLACES: string;
  SCHEDULE_PUBLISH_DELAY_MINUTES: number;
  SCHEDULE_PUBLISH_LIMIT: number;
}): ScheduleConfig {
  return {
    times: env.SCHEDULE_TIMES.split(",").map((t) => t.trim()),
    marketplaces: parseMarketplaceList(env.SCHEDULE_MARKETPLACES),
    publishDelayMinutes: env.SCHEDULE_PUBLISH_DELAY_MINUTES,
    publishLimit: env.SCHEDULE_PUBLISH_LIMIT,
  };
}

/**
 * Registers the two repeatable BullMQ schedules that drive the automated
 * routine: ingest each configured marketplace at each configured time (so
 * deal_candidates always reflect the most-recently-ingested data), then --
 * shortly after, once evaluation has had time to score the new offers --
 * trigger a batch publish of whatever is ready. Safe to call on every
 * server boot: `upsertJobScheduler` is keyed by the scheduler id passed as
 * its first argument, so re-registering the same id updates it in place
 * rather than creating a duplicate. To change the times/marketplaces,
 * update the env vars and restart -- there's no separate UI for this (see
 * docs/deployment.md for the tradeoff against an n8n-driven schedule).
 */
export async function registerScheduledJobs(
  queues: QueueBundle,
  config: ScheduleConfig,
): Promise<void> {
  for (const time of config.times) {
    const ingestCron = toDailyCron(parseTimeOfDay(time));
    for (const marketplace of config.marketplaces) {
      await queues.offerIngestion.upsertJobScheduler(
        `scheduled-ingest-${marketplace}-${time}`,
        { pattern: ingestCron, tz: "UTC" },
        { name: "scheduled-ingest", data: { marketplace } },
      );
    }

    const publishCron = toDailyCron(addMinutesToTimeOfDay(time, config.publishDelayMinutes));
    await queues.scheduledPublish.upsertJobScheduler(
      `scheduled-publish-${time}`,
      { pattern: publishCron, tz: "UTC" },
      { name: "scheduled-publish", data: { limit: config.publishLimit } },
    );
  }

  console.log(
    `[scheduler] registered ${config.times.length} ingest+publish cycle(s)/day for [${config.marketplaces.join(", ")}] at UTC times [${config.times.join(", ")}] (publish +${config.publishDelayMinutes}min)`,
  );
}
