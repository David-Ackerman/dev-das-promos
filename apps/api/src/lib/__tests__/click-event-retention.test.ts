import { type Database, clickEvents } from "@dev-das-promos/database";
import { describe, expect, it, vi } from "vitest";
import { deleteExpiredClickEvents } from "../click-event-retention.js";

describe("deleteExpiredClickEvents", () => {
  it("deletes events before the retention cutoff and returns the deleted count", async () => {
    const batches = [[{ id: "one" }, { id: "two" }], []];
    const limit = vi.fn().mockImplementation(async () => batches.shift() ?? []);
    const selectOrderBy = vi.fn().mockReturnValue({ limit });
    const selectWhere = vi.fn().mockReturnValue({ orderBy: selectOrderBy });
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    const select = vi.fn().mockReturnValue({ from: selectFrom });
    const returning = vi.fn().mockResolvedValue([{ id: "one" }, { id: "two" }]);
    const deleteWhere = vi.fn().mockReturnValue({ returning });
    const deleteQuery = vi.fn().mockReturnValue({ where: deleteWhere });
    const db = { select, delete: deleteQuery } as unknown as Database;

    await expect(
      deleteExpiredClickEvents(db, 30, new Date("2026-09-30T00:00:00.000Z")),
    ).resolves.toBe(2);

    expect(select).toHaveBeenCalledTimes(2);
    expect(limit).toHaveBeenCalledTimes(2);
    expect(limit).toHaveBeenCalledWith(5_000);
    expect(deleteQuery).toHaveBeenCalledWith(clickEvents);
    expect(deleteWhere).toHaveBeenCalledOnce();
  });

  it("rejects an invalid retention period", async () => {
    const db = { delete: vi.fn() } as unknown as Database;
    await expect(deleteExpiredClickEvents(db, 0)).rejects.toThrow(/positive whole number/);
    expect(db.delete).not.toHaveBeenCalled();
  });
});
