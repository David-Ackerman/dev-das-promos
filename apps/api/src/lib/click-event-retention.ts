import { type Database, clickEvents } from "@dev-das-promos/database";
import { inArray, lt } from "drizzle-orm";

const DAY_MS = 24 * 60 * 60 * 1000;
const DELETE_BATCH_SIZE = 5_000;

/** Delete raw click records outside the configured rolling retention window. */
export async function deleteExpiredClickEvents(
  db: Database,
  retentionDays: number,
  now = new Date(),
): Promise<number> {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) {
    throw new Error("Click event retention must be a positive whole number of days");
  }
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  let deletedCount = 0;

  while (true) {
    const expired = await db
      .select({ id: clickEvents.id })
      .from(clickEvents)
      .where(lt(clickEvents.occurredAt, cutoff))
      .orderBy(clickEvents.occurredAt)
      .limit(DELETE_BATCH_SIZE);
    if (expired.length === 0) break;

    const deleted = await db
      .delete(clickEvents)
      .where(
        inArray(
          clickEvents.id,
          expired.map(({ id }) => id),
        ),
      )
      .returning({ id: clickEvents.id });
    deletedCount += deleted.length;
  }

  return deletedCount;
}

/** Run retention once at startup and then daily; the timer is cleared on shutdown. */
export function startClickEventRetention(
  db: Database,
  retentionDays: number,
  log: (message: string, error?: unknown) => void = console.info,
): () => void {
  let running = false;
  const prune = async () => {
    if (running) return;
    running = true;
    try {
      const deletedCount = await deleteExpiredClickEvents(db, retentionDays);
      if (deletedCount > 0) {
        log(`[retention] deleted ${deletedCount} click event(s) older than ${retentionDays} days`);
      }
    } catch (error) {
      log("[retention] failed to delete expired click events", error);
    } finally {
      running = false;
    }
  };

  void prune();
  const timer = setInterval(() => void prune(), DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
