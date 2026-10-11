/**
 * End-to-end flow against a real Postgres (TEST_DATABASE_URL), with every
 * external API (Shopee, AI, Telegram, X) mocked. Skipped when no test DB.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { runCollect } from "../src/collect.ts";
import { createNodeDb } from "../src/db-node.ts";
import { createHandler } from "../src/http.ts";
import { migrate } from "../src/migrate.ts";
import type { Candidate } from "../src/types.ts";
import { mockFetch, telegramRoute, testConfig } from "./helpers.ts";

const DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/promos_test";
const hasDb = await (async () => {
  const db = createNodeDb(DB_URL);
  try {
    await db.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await db.close();
  }
})();

const suffix = Date.now().toString(36);
const shopeeOffers = (): Candidate[] => [
  { marketplace: "shopee", externalId: `s-big-${suffix}`, title: "Fone Bluetooth TWS", imageUrl: "https://img/x.jpg", productUrl: "https://shopee.com.br/p/1", priceCents: 4990, originalPriceCents: 9980, discountPct: 50, sales: 3000 },
  { marketplace: "shopee", externalId: `s-mid-${suffix}`, title: "Air Fryer 4L", productUrl: "https://shopee.com.br/p/2", priceCents: 29900, originalPriceCents: 39900, discountPct: 25 },
  { marketplace: "shopee", externalId: `s-low-${suffix}`, title: "Capinha", productUrl: "https://shopee.com.br/p/3", priceCents: 990, originalPriceCents: 1090, discountPct: 9 },
];

describe("full flow", { skip: !hasDb && "no test database" }, () => {
  const db = createNodeDb(DB_URL);
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
  const flush = async () => {
    while (waits.length) await waits.shift();
  };

  before(async () => {
    const log = () => {};
    await migrate(DB_URL, log);
    assert.deepEqual(await migrate(DB_URL, log), [], "second migrate is a no-op");
  });
  after(() => db.close());

  it("collects, previews, approves, publishes, tracks clicks and reports stats", async () => {
    const cfg = testConfig({ X_MODE: "no-link", X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c", X_ACCESS_TOKEN_SECRET: "d" });
    const f = mockFetch([
      ["api.telegram.org", telegramRoute()],
      ["chat/completions", () => ({ choices: [{ message: { content: '{"texto":"Agora dá pra ignorar o mundo com estilo 🎧","tweet":"Silêncio custa pouco 🎧"}' } }] })],
      ["affiliate.shopee", (c) => ({ data: { generateShortLink: { shortLink: `https://s.shopee.com.br/${c.body.variables.input.subIds[0]}` } } })],
      ["api.x.com", () => ({ data: { id: "tweet-1" } })],
    ]);
    try {
      // 1. Collect
      const res = await runCollect(cfg, db, { fetchShopee: async () => shopeeOffers(), log: () => {} });
      assert.equal(res.previews, 2);
      assert.deepEqual(res.errors, []);
      const previews = f.to("sendPhoto").concat(f.to("sendMessage")).filter((c) => c.body.chat_id === "111");
      assert.equal(previews.length, 2);
      assert.match(previews[0]!.body.caption ?? previews[0]!.body.text, /Prévia #\d+/);
      assert.equal(previews[0]!.body.reply_markup.inline_keyboard[0][0].text, "✅ Aprovar");

      const posts = await db.query<{ id: number; status: string; affiliate_url: string; ref: string }>(
        `SELECT p.id, p.status, p.affiliate_url, p.ref FROM posts p JOIN products pr ON pr.id = p.product_id WHERE pr.external_id LIKE $1 ORDER BY p.discount_pct DESC`,
        [`%${suffix}`],
      );
      assert.equal(posts.length, 2);
      const [big, mid] = posts as [(typeof posts)[0], (typeof posts)[0]];
      assert.equal(big.status, "pending");
      assert.equal(big.affiliate_url, `https://s.shopee.com.br/${big.ref}`, "Shopee sub-id = post ref");

      // Running again must not suggest the same products (cooldown).
      const again = await runCollect(cfg, db, { fetchShopee: async () => shopeeOffers(), log: () => {} });
      assert.equal(again.previews, 0);

      // 2. Webhook security
      const handler = createHandler(() => ({ cfg, db }));
      const hook = (update: unknown, secret = "secret_secret_secret") =>
        handler.fetch(
          new Request("https://w/telegram/webhook", {
            method: "POST",
            headers: { "x-telegram-bot-api-secret-token": secret },
            body: JSON.stringify(update),
          }),
          {},
          ctx,
        );
      assert.equal((await hook({ update_id: 1 }, "wrong")).status, 403);

      // Non-admin cannot approve
      await hook({ update_id: 2, callback_query: { id: "q0", from: { id: 999 }, data: `a:${big.id}` } });
      await flush();
      assert.equal((await db.query<{ status: string }>(`SELECT status FROM posts WHERE id=$1`, [big.id]))[0]!.status, "pending");

      // 3. Reply to the preview to replace the text
      const preview = (await db.query<{ preview_message_id: string }>(`SELECT preview_message_id::text FROM posts WHERE id=$1`, [big.id]))[0]!;
      await hook({ update_id: 3, message: { message_id: 5, chat: { id: 111, type: "private" }, from: { id: 111 }, text: "Texto meu, feito à mão", reply_to_message: { message_id: Number(preview.preview_message_id) } } });
      await flush();
      assert.equal((await db.query<{ caption: string }>(`SELECT caption FROM posts WHERE id=$1`, [big.id]))[0]!.caption, "Texto meu, feito à mão");

      // 4. Approve (tapped twice -> published once)
      const before = f.calls.length;
      await hook({ update_id: 4, callback_query: { id: "q1", from: { id: 111 }, data: `a:${big.id}` } });
      await hook({ update_id: 5, callback_query: { id: "q2", from: { id: 111 }, data: `a:${big.id}` } });
      await flush();
      const sent = f.calls.slice(before).filter((c) => /sendPhoto|sendMessage/.test(c.url) && String(c.body.chat_id).startsWith("-100"));
      assert.equal(sent.length, 2, "one message per Telegram group, no duplicates");
      const groupText: string = sent[0]!.body.caption ?? sent[0]!.body.text;
      assert.match(groupText, /Texto meu, feito à mão/);
      const code = groupText.match(/\/go\/([0-9a-zA-Z]+)/)![1]!;
      const tweets = f.to("api.x.com");
      assert.equal(tweets.length, 1);
      assert.ok(!tweets[0]!.body.text.includes("http"), "no-link mode keeps links out of X");
      assert.match(tweets[0]!.headers.authorization ?? "", /^OAuth /);
      const status = (await db.query<{ status: string }>(`SELECT status FROM posts WHERE id=$1`, [big.id]))[0]!.status;
      assert.equal(status, "published");
      // Preview got the WhatsApp share button
      const edits = f.to("editMessage").filter((c) => c.body.message_id === Number(preview.preview_message_id));
      const lastKb = edits.at(-1)!.body.reply_markup.inline_keyboard;
      assert.match(lastKb[0][0].url, /\/wa\/[0-9a-zA-Z]+$/);

      // 5. Redirect + click tracking
      const go = await handler.fetch(new Request(`https://w/go/${code}`, { headers: { "user-agent": "Mozilla/5.0 (iPhone)", "cf-connecting-ip": "1.2.3.4" } }), {}, ctx);
      assert.equal(go.status, 302);
      assert.equal(go.headers.get("location"), big.affiliate_url);
      await handler.fetch(new Request(`https://w/go/${code}`, { headers: { "user-agent": "TelegramBot (like TwitterBot)" } }), {}, ctx);
      await flush();
      const clicks = await db.query<{ is_bot: boolean }>(`SELECT is_bot FROM clicks WHERE code=$1 ORDER BY id`, [code]);
      assert.deepEqual(clicks.map((c) => c.is_bot), [false, true]);
      assert.equal((await handler.fetch(new Request("https://w/go/nope123"), {}, ctx)).status, 404);

      // 6. WhatsApp share redirect
      const waUrl: string = lastKb[0][0].url;
      const wa = await handler.fetch(new Request(waUrl.replace(cfg.publicBaseUrl, "https://w")), {}, ctx);
      assert.equal(wa.status, 302);
      const waText = new URL(wa.headers.get("location")!).searchParams.get("text")!;
      assert.match(waText, /\*Fone Bluetooth TWS\*/);
      assert.match(waText, /\/go\/[0-9a-zA-Z]+/);

      // 7. Decline the other one
      await hook({ update_id: 6, callback_query: { id: "q3", from: { id: 111 }, data: `d:${mid.id}` } });
      await flush();
      assert.equal((await db.query<{ status: string }>(`SELECT status FROM posts WHERE id=$1`, [mid.id]))[0]!.status, "declined");

      // 8. Stats
      await hook({ update_id: 7, message: { message_id: 6, chat: { id: 111, type: "private" }, from: { id: 111 }, text: "/stats 30" } });
      await flush();
      const statsMsg = f.to("sendMessage").at(-1)!.body.text as string;
      assert.match(statsMsg, /Cliques por canal/);
      assert.match(statsMsg, /telegram: \d+/);
      assert.match(statsMsg, /Fone Bluetooth TWS — 1 cliques/);

      // 9. /id works for anyone (for setting up groups)
      await hook({ update_id: 8, message: { message_id: 7, chat: { id: -1009, type: "supergroup" }, from: { id: 5 }, text: "/id@meubot" } });
      await flush();
      assert.match(f.to("sendMessage").at(-1)!.body.text, /-1009/);
    } finally {
      f.restore();
    }
  });

  it("expires previews nobody answered", async () => {
    const cfg = testConfig();
    const f = mockFetch([["api.telegram.org", telegramRoute()], ["chat/completions", () => new Response("x", { status: 500 })], ["affiliate.shopee", () => ({ data: { generateShortLink: { shortLink: "https://s.shopee.com.br/z" } } })]]);
    try {
      const offers: Candidate[] = [{ marketplace: "shopee", externalId: `exp-${suffix}`, title: "Mouse", productUrl: "https://shopee.com.br/p/9", priceCents: 5000, originalPriceCents: 10000, discountPct: 50 }];
      await runCollect(cfg, db, { fetchShopee: async () => offers, log: () => {} });
      const [post] = await db.query<{ id: number; ai_model: string }>(`SELECT p.id, p.ai_model FROM posts p JOIN products pr ON pr.id=p.product_id WHERE pr.external_id=$1`, [`exp-${suffix}`]);
      assert.equal(post!.ai_model, "template", "AI failure falls back to template");
      await db.query(`UPDATE posts SET created_at = now() - interval '2 days' WHERE id=$1`, [post!.id]);
      const res = await runCollect(cfg, db, { fetchShopee: async () => [], log: () => {} });
      assert.ok(res.expired >= 1);
      assert.equal((await db.query<{ status: string }>(`SELECT status FROM posts WHERE id=$1`, [post!.id]))[0]!.status, "expired");
    } finally {
      f.restore();
    }
  });
});
