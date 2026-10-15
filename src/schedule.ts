/**
 * Publishing queue timing. Approved posts go out one at a time, spaced by
 * QUEUE_INTERVAL_MINUTES, only inside POSTING_HOURS (Brasília time).
 */
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

/** "8-23" -> { startHour: 8, endHour: 23 }. */
export function parsePostingHours(raw: string | undefined): { startHour: number; endHour: number } {
  const m = (raw?.trim() || "8-23").match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  const startHour = Number(m?.[1]);
  const endHour = Number(m?.[2]);
  if (!m || startHour < 0 || endHour > 24 || startHour >= endHour) {
    throw new Error(`POSTING_HOURS must look like 8-23 (got "${raw}")`);
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
