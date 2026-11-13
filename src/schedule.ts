/**
 * Publishing queue timing. Deals are searched 3 times a day (COLLECT_HOURS);
 * the posts approved from a batch are spread evenly until the next search
 * (or the end of POSTING_HOURS), never closer than QUEUE_INTERVAL_MINUTES.
 */

/** Brasília hours the Worker cron starts a search (wrangler.toml, at :07; test/unit.test.ts checks they match). */
export const COLLECT_HOURS = [6, 12, 18];
export interface QueueSettings {
  /** Minutes between two posts; 0 = publish as soon as approved (no queue). */
  intervalMinutes: number;
  /** Posting window in Brasília time, e.g. 8–23 = from 08:00 until 22:59. */
  startHour: number;
  endHour: number;
}

/** Brazil dropped daylight saving in 2019, so Brasília is always UTC−3. */
const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "6-23" -> { startHour: 6, endHour: 23 }. */
export function parsePostingHours(raw: string | undefined): { startHour: number; endHour: number } {
  const m = (raw?.trim() || "6-23").match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  const startHour = Number(m?.[1]);
  const endHour = Number(m?.[2]);
  if (!m || startHour < 0 || endHour > 24 || startHour >= endHour) {
    throw new Error(`POSTING_HOURS must look like 6-23 (got "${raw}")`);
  }
  return { startHour, endHour };
}

/**
 * When the next post may go out: `interval` after the last one (published or
 * already queued), never before `now`, moved to the next window opening if it
 * falls outside POSTING_HOURS.
 */
export function nextSlot(now: Date, last: Date | null, q: QueueSettings): Date {
  const earliest = Math.max(now.getTime(), last ? last.getTime() + q.intervalMinutes * 60_000 : 0);
  const local = new Date(earliest + BRT_OFFSET_MS);
  const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  if (hour >= q.startHour && hour < q.endHour) return new Date(earliest);
  const opening = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), q.startHour);
  return new Date((hour < q.startHour ? opening : opening + DAY_MS) - BRT_OFFSET_MS);
}

/** "14:40", "amanhã 08:00" or "17/10 08:00", in Brasília time. */
export function formatSlot(at: Date, now: Date): string {
  const local = new Date(at.getTime() + BRT_OFFSET_MS);
  const today = new Date(now.getTime() + BRT_OFFSET_MS);
  const hhmm = `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
  const days = Math.round(
    (Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) /
      DAY_MS,
  );
  if (days <= 0) return hhmm;
  if (days === 1) return `amanhã ${hhmm}`;
  return `${String(local.getUTCDate()).padStart(2, "0")}/${String(local.getUTCMonth() + 1).padStart(2, "0")} ${hhmm}`;
}

/** Brasília hour of `at` as a fraction (14:30 -> 14.5). */
function brtHour(at: Date): number {
  const local = new Date(at.getTime() + BRT_OFFSET_MS);
  return local.getUTCHours() + local.getUTCMinutes() / 60;
}

/** `hour` o'clock (Brasília) on the day of `at`, as a real instant; hour may be ≥ 24 (next day). */
function atBrtHour(at: Date, hour: number): Date {
  const local = new Date(at.getTime() + BRT_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + hour * 3_600_000 - BRT_OFFSET_MS);
}

/**
 * The search window `at` falls in: from the last search hour at or before it
 * to the next one, capped at the end of POSTING_HOURS.
 */
export function collectWindow(at: Date, q: QueueSettings, hours = COLLECT_HOURS): { start: Date; end: Date } {
  const h = brtHour(at);
  const sorted = [...hours].sort((a, b) => a - b);
  const startHour = [...sorted].reverse().find((x) => x <= h) ?? sorted[sorted.length - 1]! - 24;
  const nextHour = sorted.find((x) => x > h) ?? sorted[0]! + 24;
  const end = Math.min(nextHour, startHour < 0 ? q.endHour - 24 : q.endHour > startHour ? q.endHour : nextHour);
  return { start: atBrtHour(at, startHour), end: atBrtHour(at, Math.max(end, h)) };
}

/**
 * When an approved post goes out. The first post of a batch goes right away; the
 * next ones share what's left of the window evenly with the posts still waiting
 * (`waiting`: previews not yet approved, which will need a slot too), never
 * closer than QUEUE_INTERVAL_MINUTES. Outside POSTING_HOURS: the next opening.
 */
export function spreadSlot(now: Date, last: Date | null, waiting: number, q: QueueSettings, hours = COLLECT_HOURS): Date {
  const h = brtHour(now);
  if (h < q.startHour || h >= q.endHour) return nextSlot(now, last, q);
  const win = collectWindow(now, q, hours);
  if (!last || last.getTime() < win.start.getTime()) return nextSlot(now, null, q);
  const minGap = q.intervalMinutes * 60_000;
  // +2: the last post lands one share before the window ends, not on top of the next search.
  const share = (win.end.getTime() - last.getTime()) / (Math.max(0, waiting) + 2);
  const at = new Date(Math.max(now.getTime(), last.getTime() + Math.max(minGap, share)));
  // Rounded to the minute: "14:37", not "14:36:59".
  const rounded = new Date(Math.ceil(at.getTime() / 60_000) * 60_000);
  return nextSlot(rounded, null, q);
}
