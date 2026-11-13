import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { handleUpdate, INLINE_LINKS } from "../src/bot.ts";
import { COLLECT_HOURS, collectWindow, spreadSlot } from "../src/schedule.ts";
import { mockFetch, testConfig } from "./helpers.ts";

const q = { intervalMinutes: 15, startHour: 6, endHour: 23 };
const brt = (hhmm: string, day = "13") => new Date(`2026-11-${day}T${hhmm}:00-03:00`);
const hhmm = (d: Date) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(11, 16);

describe("3 searches a day", () => {
  it("the Worker cron starts the search at COLLECT_HOURS (Brasília)", () => {
    const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    const crons = JSON.parse(toml.match(/^crons\s*=\s*(\[.*\])/m)![1]!) as string[];
    const collect = crons.find((c) => /^7 [\d,]+ \* \* \*$/.test(c))!;
    const utcHours = collect.split(" ")[1]!.split(",").map(Number);
    assert.deepEqual(utcHours.map((h) => (h + 21) % 24).sort((a, b) => a - b), COLLECT_HOURS);
  });

  it("knows the window a moment falls in, ending at the next search or the end of POSTING_HOURS", () => {
    const w = (t: string) => collectWindow(brt(t), q);
    assert.deepEqual([hhmm(w("06:10").start), hhmm(w("06:10").end)], ["06:00", "12:00"]);
    assert.deepEqual([hhmm(w("12:07").start), hhmm(w("12:07").end)], ["12:00", "18:00"]);
    assert.deepEqual([hhmm(w("18:30").start), hhmm(w("18:30").end)], ["18:00", "23:00"]);
  });
});

describe("spreading a batch until the next search", () => {
  const batch = (at: string, size: number, previous: Date) => {
    const out: string[] = [];
    let last: Date | null = previous;
    for (let i = 0; i < size; i++) {
      const slot = spreadSlot(brt(at), last, size - 1 - i, q);
      out.push(hhmm(slot));
      last = slot;
    }
    return out;
  };

  it("posts the first one now and spreads the rest evenly, all before the next search", () => {
    const morning = batch("06:10", 8, brt("22:40", "12"));
    assert.equal(morning[0], "06:10");
    assert.ok(morning.every((t) => t < "12:00"), morning.join(" "));
    const gaps = morning.slice(1).map((t, i) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) - (Number(morning[i]!.slice(0, 2)) * 60 + Number(morning[i]!.slice(3))));
    assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, `even gaps: ${gaps}`);
    const evening = batch("18:08", 10, brt("17:20"));
    assert.ok(evening.every((t) => t >= "18:08" && t < "23:00"), evening.join(" "));
  });

  it("never closer than QUEUE_INTERVAL_MINUTES, and outside POSTING_HOURS waits for the opening", () => {
    const tight = spreadSlot(brt("22:50"), brt("22:45"), 5, q);
    assert.ok(tight.getTime() - brt("22:45").getTime() >= 15 * 60_000 || hhmm(tight) === "06:00");
    assert.equal(hhmm(spreadSlot(brt("23:30"), brt("22:40"), 3, q)), "06:00");
  });
});

describe("Telegram: manual search and batches of links", () => {
  const cfg = testConfig({ GH_DISPATCH_TOKEN: "ghp_x", GH_REPO: "me/repo" });
  const db = { query: async () => [] } as never;
  const admin = Number(cfg.telegram.adminChatId);

  it("🔎 starts the Collect workflow", async () => {
    const f = mockFetch([
      ["api.github.com", () => new Response(null, { status: 204 })],
      ["api.telegram.org", () => ({ ok: true, result: true })],
    ]);
    try {
      await handleUpdate(cfg, db, { update_id: 1, callback_query: { id: "c", from: { id: admin } as never, data: "s:0" } });
      assert.match(f.to("api.github.com")[0]!.url, /workflows\/collect\.yml\/dispatches$/);
      assert.match(f.to("answerCallbackQuery")[0]!.body.text, /Buscando/);
    } finally {
      f.restore();
    }
  });

  it("more than a few links in one message go to GitHub Actions in one go", async () => {
    const links = Array.from({ length: INLINE_LINKS + 5 }, (_, i) => `https://meli.la/abc${i}`).join("\n");
    const f = mockFetch([
      ["api.github.com", () => new Response(null, { status: 204 })],
      ["api.telegram.org", () => ({ ok: true, result: { message_id: 9 } })],
    ]);
    try {
      await handleUpdate(cfg, db, { update_id: 2, message: { message_id: 77, chat: { id: admin }, from: { id: admin }, text: links } as never });
      const call = f.to("api.github.com")[0]!;
      assert.match(call.url, /workflows\/links\.yml\/dispatches$/);
      assert.deepEqual(call.body.inputs, { text: links, chat_id: cfg.telegram.adminChatId, message_id: "77" });
      assert.match(f.to("sendMessage")[0]!.body.text, /Recebi 8 links/);
    } finally {
      f.restore();
    }
  });
});
