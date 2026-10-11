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

  const ai = () => ({ choices: [{ message: { content: '{"texto":"Texto da IA","tweet":"Tweet da IA"}' } }] });
  const shortLink = () => ({ data: { generateShortLink: { shortLink: "https://s.shopee.com.br/z" } } });
  const offer = (id: string, over: Partial<Candidate> = {}): Candidate => ({
    marketplace: "shopee", externalId: `${id}-${suffix}`, title: `Produto ${id}`, productUrl: "https://shopee.com.br/p/7",
    priceCents: 5000, originalPriceCents: 10000, discountPct: 50, ...over,
  });
  const collect = (cfg: ReturnType<typeof testConfig>, offers: Candidate[]) =>
    runCollect(cfg, db, { fetchShopee: async () => offers, log: () => {} });
  const postFor = async (id: string) =>
    (await db.query<{ id: number; status: string; preview_message_id: string | null }>(
      `SELECT p.id, p.status, p.preview_message_id::text FROM posts p JOIN products pr ON pr.id = p.product_id
       WHERE pr.external_id = $1 ORDER BY p.id DESC LIMIT 1`,
      [`${id}-${suffix}`],
    ))[0]!;
  const tap = async (cfg: ReturnType<typeof testConfig>, data: string) => {
    const res = await createHandler(() => ({ cfg, db })).fetch(
      new Request("https://w/telegram/webhook", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "secret_secret_secret" },
        body: JSON.stringify({ update_id: 1, callback_query: { id: "q", from: { id: 111 }, data } }),
      }),
      {},
      ctx,
    );
    await flush();
    return res;
  };
  const xOn = { X_MODE: "no-link", X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c", X_ACCESS_TOKEN_SECRET: "d" };

  it("retries only the destinations that failed", async () => {
    const cfg = testConfig(xOn);
    let groupDown = true;
    const f = mockFetch([
      [/sendPhoto|sendMessage/, (c) =>
        c.body.chat_id === "-1002" && groupDown
          ? new Response(JSON.stringify({ ok: false, description: "Forbidden: bot was kicked" }), { status: 403 })
          : { ok: true, result: { message_id: 4242 } }],
      ["api.telegram.org", telegramRoute()],
      ["chat/completions", ai],
      ["affiliate.shopee", shortLink],
      ["api.x.com", () => ({ data: { id: "tweet-2" } })],
    ]);
    const groupSends = () => f.calls.filter((c) => /sendPhoto|sendMessage/.test(c.url) && String(c.body.chat_id).startsWith("-100")).map((c) => c.body.chat_id);
    try {
      await collect(cfg, [offer("retry")]);
      const post = await postFor("retry");
      await tap(cfg, `t:${post.id}`);
      assert.equal(f.to("answerCallbackQuery").at(-1)!.body.text, "Nada para reenviar.", "nothing to retry while pending");

      await tap(cfg, `a:${post.id}`);
      assert.equal((await postFor("retry")).status, "partial");
      const kb = f.to("editMessage").at(-1)!.body.reply_markup.inline_keyboard;
      assert.match(kb[0][0].url, /\/wa\//);
      assert.equal(kb[1][0].callback_data, `t:${post.id}`, "partial post offers a retry");
      await tap(cfg, `a:${post.id}`);
      assert.equal(f.to("answerCallbackQuery").at(-1)!.body.text, "Esse post já foi processado.");

      groupDown = false;
      const sentBefore = groupSends().length;
      await tap(cfg, `t:${post.id}`);
      assert.deepEqual(groupSends().slice(sentBefore), ["-1002"], "only the group that failed gets it");
      assert.equal(f.to("api.x.com").length, 1, "X is not posted twice");
      assert.equal((await postFor("retry")).status, "published");
      const finalEdit = f.to("editMessage").at(-1)!.body;
      assert.match(finalEdit.text ?? finalEdit.caption, /Enviado: Telegram -1001, Telegram -1002, X/);
      assert.equal(finalEdit.reply_markup.inline_keyboard.length, 1, "retry button is gone, WhatsApp stays");
      const manual = await db.query(`SELECT 1 FROM publications WHERE post_id = $1 AND status = 'manual'`, [post.id]);
      assert.equal(manual.length, 1);
    } finally {
      f.restore();
    }
  });

  it("does not call a post published when no channel is configured", async () => {
    const cfg = testConfig({ TELEGRAM_GROUP_IDS: "", WHATSAPP_MODE: "off" });
    const f = mockFetch([["api.telegram.org", telegramRoute()], ["chat/completions", ai], ["affiliate.shopee", shortLink]]);
    try {
      await collect(cfg, [offer("nochannel")]);
      const post = await postFor("nochannel");
      await tap(cfg, `a:${post.id}`);
      assert.equal((await postFor("nochannel")).status, "failed");
      assert.match(f.to("editMessage").at(-1)!.body.text, /nenhum canal configurado/);
    } finally {
      f.restore();
    }
  });

  it("unsticks posts the Worker left in publishing", async () => {
    const cfg = testConfig();
    const f = mockFetch([["api.telegram.org", telegramRoute()], ["chat/completions", ai], ["affiliate.shopee", shortLink]]);
    try {
      await collect(cfg, [offer("stuck")]);
      const post = await postFor("stuck");
      await db.query(`UPDATE posts SET status = 'publishing', decided_at = now() - interval '1 hour' WHERE id = $1`, [post.id]);
      await collect(cfg, []);
      assert.equal((await postFor("stuck")).status, "failed");
      const edit = f.to("editMessage").filter((c) => c.body.message_id === Number(post.preview_message_id)).at(-1)!.body;
      assert.match(edit.text, /Travou ao publicar/);
      assert.equal(edit.reply_markup.inline_keyboard[0][0].callback_data, `t:${post.id}`);
      await tap(cfg, `t:${post.id}`);
      assert.equal((await postFor("stuck")).status, "published");
    } finally {
      f.restore();
    }
  });

  it("tells the admin when the product was recently cheaper", async () => {
    const cfg = testConfig({ REPOST_COOLDOWN_DAYS: "0" });
    const f = mockFetch([["api.telegram.org", telegramRoute()], ["chat/completions", ai], ["affiliate.shopee", shortLink]]);
    const lastPreview = () => f.to("sendMessage").filter((c) => c.body.chat_id === "111").at(-1)!.body.text as string;
    try {
      await collect(cfg, [offer("hist")]);
      assert.doesNotMatch(lastPreview(), /30 dias/, "no history yet, no note");
      const { id } = (await db.query<{ id: number }>(`SELECT id FROM products WHERE external_id = $1`, [`hist-${suffix}`]))[0]!;
      await db.query(
        `INSERT INTO price_snapshots (product_id, price_cents, captured_at) VALUES ($1, 3990, now() - interval '5 days'), ($1, 100, now() - interval '45 days')`,
        [id],
      );
      await collect(cfg, [offer("hist")]);
      assert.match(lastPreview(), /⚠️ Já esteve por R\$\s39,90 nos últimos 30 dias/);
      await collect(cfg, [offer("hist", { priceCents: 3000, discountPct: 70 })]);
      assert.match(lastPreview(), /📉 Menor preço que vimos em 30 dias/);
    } finally {
      f.restore();
    }
  });

  it("lets a product come back when its preview could not be sent", async () => {
    const cfg = testConfig();
    let telegramDown = true;
    const f = mockFetch([
      ["sendMessage", (c) =>
        telegramDown && /Prévia/.test(c.body.text)
          ? new Response(JSON.stringify({ ok: false, description: "Too Many Requests" }), { status: 429 })
          : { ok: true, result: { message_id: 4343 } }],
      ["api.telegram.org", telegramRoute()],
      ["chat/completions", ai],
      ["affiliate.shopee", shortLink],
    ]);
    try {
      const res = await collect(cfg, [offer("ghost")]);
      assert.equal(res.previews, 0);
      assert.match(res.errors[0]!, /Too Many Requests/);
      assert.equal((await postFor("ghost")).status, "failed", "not left pending with no buttons");
      telegramDown = false;
      assert.equal((await collect(cfg, [offer("ghost")])).previews, 1, "not on cooldown");
    } finally {
      f.restore();
    }
  });

  it("answers HEAD on /go without counting a click, rejects a broken webhook body, and reports clicks per group", async () => {
    const cfg = testConfig();
    const handler = createHandler(() => ({ cfg, db }));
    const [link] = await db.query<{ code: string; target: string }>(
      `SELECT code, target FROM links WHERE channel = 'telegram' AND target <> '' ORDER BY created_at DESC LIMIT 1`,
    );
    const clicks = async () => (await db.query(`SELECT 1 FROM clicks WHERE code = $1`, [link!.code])).length;
    const before = await clicks();
    const head = await handler.fetch(new Request(`https://w/go/${link!.code}`, { method: "HEAD" }), {}, ctx);
    assert.equal(head.status, 302);
    await handler.fetch(new Request(`https://w/go/${link!.code}`, { headers: { "user-agent": "Mozilla/5.0", "cf-connecting-ip": "9.9.9.9" } }), {}, ctx);
    await flush();
    assert.equal(await clicks(), before + 1, "only the GET is a click");

    const bad = await handler.fetch(
      new Request("https://w/telegram/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "secret_secret_secret" }, body: "not json" }),
      {},
      ctx,
    );
    assert.equal(bad.status, 400);

    const f = mockFetch([["api.telegram.org", telegramRoute()]]);
    try {
      await handler.fetch(
        new Request("https://w/telegram/webhook", {
          method: "POST",
          headers: { "x-telegram-bot-api-secret-token": "secret_secret_secret" },
          body: JSON.stringify({ update_id: 1, message: { message_id: 1, chat: { id: 111, type: "private" }, from: { id: 111 }, text: "/stats" } }),
        }),
        {},
        ctx,
      );
      await flush();
      const stats = f.to("sendMessage").at(-1)!.body.text as string;
      assert.match(stats, /Por grupo/);
      assert.ok(stats.includes(`telegram ${link!.target}: `), stats);
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
