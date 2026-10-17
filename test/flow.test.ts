/**
 * End-to-end flow against a real Postgres (TEST_DATABASE_URL), with every
 * external API (Shopee, AI, Telegram, X) mocked. Skipped when no test DB.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { healTemplateCaptions, runCollect } from "../src/collect.ts";
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

  const ai = () => ({ choices: [{ message: { content: '{"texto":"Texto da IA","tweet":"Tweet da IA","tag":"#JBL"}' } }] });
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
    const cfg = testConfig({ TELEGRAM_GROUP_IDS: "", WHATSAPP_MODE: "off", X_MODE: "off" });
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
    const cfg = testConfig({ REPOST_COOLDOWN_DAYS: "0", SKIP_FAKE_DISCOUNTS: "false" });
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

  it("skips fake discounts: products that were cheaper in the last 30 days", async () => {
    const cfg = testConfig({ REPOST_COOLDOWN_DAYS: "0" });
    const f = mockFetch([["api.telegram.org", telegramRoute()], ["chat/completions", ai], ["affiliate.shopee", shortLink]]);
    try {
      await collect(cfg, [offer("fake")]);
      const { id } = (await db.query<{ id: number }>(`SELECT id FROM products WHERE external_id = $1`, [`fake-${suffix}`]))[0]!;
      await db.query(`INSERT INTO price_snapshots (product_id, price_cents, captured_at) VALUES ($1, 3500, now() - interval '3 days')`, [id]);
      const before = (await db.query(`SELECT 1 FROM posts WHERE product_id = $1`, [id])).length;
      const res = await collect(cfg, [offer("fake")]);
      assert.equal(res.previews, 0, "R$ 50 now, R$ 35 three days ago: not a real deal");
      assert.equal((await db.query(`SELECT 1 FROM posts WHERE product_id = $1`, [id])).length, before);
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

  it("gives share buttons for WhatsApp and X after approval, and never ✅ / 🔄 again", async () => {
    const cfg = testConfig();
    const f = mockFetch([["api.telegram.org", telegramRoute()], ["chat/completions", ai], ["affiliate.shopee", shortLink]]);
    try {
      await collect(cfg, [offer("share")]);
      const post = await postFor("share");
      await tap(cfg, `a:${post.id}`);
      assert.equal((await postFor("share")).status, "published");
      const edits = f.to("editMessage").filter((c) => c.body.message_id === Number(post.preview_message_id));
      assert.deepEqual(edits[0]!.body.reply_markup.inline_keyboard, [], "buttons come off before publishing");
      const kb = edits.at(-1)!.body.reply_markup.inline_keyboard;
      assert.deepEqual(kb.map((row: { text: string }[]) => row[0]!.text), ["📲 Enviar no WhatsApp", "🐦 Postar no X"]);
      assert.equal(f.to("api.x.com").length, 0, "share mode never calls the paid API");

      const handler = createHandler(() => ({ cfg, db }));
      const xUrl: string = kb[1][0].url;
      const x = await handler.fetch(new Request(xUrl.replace(cfg.publicBaseUrl, "https://w")), {}, ctx);
      assert.equal(x.status, 200, "a page, not a redirect into Telegram's logged-out browser");
      assert.match(x.headers.get("content-type")!, /text\/html/);
      const html = await x.text();
      const appLink = decodeURIComponent(html.match(/href="twitter:\/\/post\?message=([^"]+)"/)![1]!);
      assert.ok(html.includes(`https://x.com/intent/post?text=${encodeURIComponent(appLink)}`), "web fallback has the same text");
      const text = appLink;
      assert.ok(html.includes("<textarea"), "text shown for copying");
      assert.match(text, /Tweet da IA/);
      assert.match(text, /R\$\s50,00 \(-50%\)/);
      assert.match(text, /\n#publi #JBL$/, "one product hashtag on X");
      const code = xUrl.split("/").pop()!;
      assert.ok(text.includes(`/go/${code}`), "X gets its own tracked link");
      const waCode = (kb[0][0].url as string).split("/").pop()!;
      assert.equal((await handler.fetch(new Request(`https://w/x/${waCode}`), {}, ctx)).status, 404);

      await tap(cfg, `r:${post.id}`);
      assert.equal(f.to("answerCallbackQuery").at(-1)!.body.text, "Esse post já foi processado.");
    } finally {
      f.restore();
    }
  });

  it("always changes the text on 🔄 and tells the admin when the AI fails", async () => {
    const cfg = testConfig();
    const f = mockFetch([
      ["api.telegram.org", telegramRoute()],
      ["chat/completions", () => new Response(JSON.stringify({ error: { message: "model only available on agentic harnesses" } }), { status: 403 })],
      ["affiliate.shopee", shortLink],
    ]);
    try {
      const res = await collect(cfg, [offer("regen")]);
      assert.ok(res.errors.some((e) => /IA falhou.*agentic harnesses/.test(e)), "collect reports the AI error");
      const post = await postFor("regen");
      const caption = async () => (await db.query<{ caption: string }>(`SELECT caption FROM posts WHERE id = $1`, [post.id]))[0]!.caption;
      for (let i = 0; i < 8; i++) {
        const before = await caption();
        await tap(cfg, `r:${post.id}`);
        assert.notEqual(await caption(), before, "🔄 never keeps the same text");
      }
      assert.match(f.to("sendMessage").at(-1)!.body.text, /A IA falhou.*agentic harnesses/s);

      // With GitHub dispatch configured, the retry is handed to Actions (heal.yml) instead.
      const withGh = testConfig({ GH_DISPATCH_TOKEN: "ghp_x", GH_REPO: "me/repo" });
      const gh = mockFetch([
        ["api.github.com", () => new Response(null, { status: 204 })],
        ["api.telegram.org", telegramRoute()],
        ["chat/completions", () => new Response("{}", { status: 429 })],
      ]);
      try {
        await tap(withGh, `r:${post.id}`);
        assert.equal(gh.to("api.github.com")[0]!.url, "https://api.github.com/repos/me/repo/actions/workflows/heal.yml/dispatches");
        assert.match(gh.to("sendMessage").at(-1)!.body.text, /pedi de novo em segundo plano/);
      } finally {
        gh.restore();
      }
    } finally {
      f.restore();
    }
  });

  it("still removes the buttons and publishes when Telegram refuses the preview edit", async () => {
    const cfg = testConfig({ X_MODE: "off", WHATSAPP_MODE: "off" });
    const f = mockFetch([
      [/editMessage(Text|Caption)/, () => new Response(JSON.stringify({ ok: false, description: "Bad Request: message caption is too long" }), { status: 400 })],
      ["api.telegram.org", telegramRoute()],
      ["chat/completions", ai],
      ["affiliate.shopee", shortLink],
    ]);
    try {
      await collect(cfg, [offer("noedit")]);
      const post = await postFor("noedit");
      await tap(cfg, `a:${post.id}`);
      assert.equal((await postFor("noedit")).status, "published");
      const markups = f.to("editMessageReplyMarkup").filter((c) => c.body.message_id === Number(post.preview_message_id));
      assert.ok(markups.length >= 1);
      assert.deepEqual(markups.at(-1)!.body.reply_markup.inline_keyboard, []);
    } finally {
      f.restore();
    }
  });

  const say = async (cfg: ReturnType<typeof testConfig>, text: string, chat = 111) => {
    await createHandler(() => ({ cfg, db })).fetch(
      new Request("https://w/telegram/webhook", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "secret_secret_secret" },
        body: JSON.stringify({ update_id: 1, message: { message_id: 50, chat: { id: chat, type: chat === 111 ? "private" : "supergroup" }, from: { id: 111 }, text } }),
      }),
      {},
      ctx,
    );
    await flush();
  };
  type LinkPost = { id: number; status: string; price_cents: number; original_price_cents: number | null; caption: string; ai_model: string; title: string; marketplace: string; external_id: string };
  const postByLink = async (link: string) =>
    (await db.query<LinkPost>(
      `SELECT p.id, p.status, p.price_cents, p.original_price_cents, p.caption, p.ai_model, pr.title, pr.marketplace, pr.external_id
       FROM posts p JOIN products pr ON pr.id = p.product_id WHERE p.affiliate_url = $1 ORDER BY p.id DESC LIMIT 1`,
      [link],
    ))[0];

  it("turns an Amazon link sent to the bot into a preview, and publishes the link untouched", async () => {
    const cfg = testConfig({ X_MODE: "off", WHATSAPP_MODE: "off" });
    const asin = `B0${suffix.toUpperCase().padEnd(8, "X").slice(0, 8)}`;
    const link = `https://www.amazon.com.br/Fone-Bluetooth-Teste/dp/${asin}?tag=meu-20&linkCode=ll1`;
    const page = `<span id="productTitle">Fone Bluetooth Teste</span>
      <span id="corePrice_feature_div"><span class="a-offscreen">R$ 89,90</span></span>
      <span class="a-text-price" data-a-strike="true"><span class="a-offscreen">R$ 179,80</span></span>`;
    const f = mockFetch([
      ["amazon.com.br", () => new Response(page, { status: 200 })],
      ["api.telegram.org", telegramRoute()],
      ["chat/completions", ai],
    ]);
    try {
      await say(cfg, link, -1001);
      assert.equal(await postByLink(link), undefined, "links posted in groups are ignored");

      await say(cfg, link);
      const post = (await postByLink(link))!;
      assert.equal(post.status, "pending");
      assert.equal(post.marketplace, "amazon");
      assert.equal(post.external_id, asin);
      assert.equal(post.title, "Fone Bluetooth Teste");
      assert.deepEqual([post.price_cents, post.original_price_cents], [8990, 17980]);
      assert.equal(post.caption, "Texto da IA");
      const preview = f.to("sendMessage").filter((c) => c.body.chat_id === "111").at(-1)!.body;
      assert.match(preview.text, /Prévia #\d+<\/b> · Amazon · -50%/);
      assert.equal(preview.reply_markup.inline_keyboard[0][0].text, "✅ Aprovar");

      await tap(cfg, `a:${post.id}`);
      assert.equal((await postByLink(link))!.status, "published");
      const groupMsg = f.calls.filter((c) => /sendMessage|sendPhoto/.test(c.url) && c.body.chat_id === "-1001").at(-1)!.body;
      const code = (groupMsg.text ?? groupMsg.caption).match(/\/go\/([0-9a-zA-Z]+)/)[1];
      const go = await createHandler(() => ({ cfg, db })).fetch(new Request(`https://w/go/${code}`, { method: "HEAD" }), {}, ctx);
      assert.equal(go.headers.get("location"), link, "the affiliate link is kept byte for byte");
    } finally {
      f.restore();
    }
  });

  it("builds a full preview from a bare meli.la link", async () => {
    const cfg = testConfig();
    const id = `MLB7${Date.now() % 1e9}`;
    const link = `https://meli.la/${suffix}`;
    const page = `<meta property="og:title" content="Smartphone Oppo Reno 14F 5G">
      <meta property="og:image" content="https://http2.mlstatic.com/D_NQ_NP_1-O.webp">
      <script>{"a":"card-featured","u":"?wid=${id}&c=1","tracks":{"price":{"price":2987.72}},
      "price":{"previous_price":{"value":3999},"current_price":{"value":2987}},"n":"?wid=MLB1&x","tracks2":{"price":{"price":10}}}</script>`;
    const f = mockFetch([
      ["meli.la", () => new Response(page, { status: 200 })],
      ["api.telegram.org", telegramRoute()],
      ["chat/completions", ai],
    ]);
    try {
      await say(cfg, link);
      const post = (await postByLink(link))!;
      assert.equal(post.marketplace, "mercadolivre");
      assert.equal(post.external_id, id, "showcase pages share one URL, so the id comes from the page");
      assert.equal(post.title, "Smartphone Oppo Reno 14F 5G");
      assert.deepEqual([post.price_cents, post.original_price_cents], [298772, 399900]);
      const preview = f.to("sendPhoto").filter((c) => c.body.chat_id === "111").at(-1)!.body;
      assert.equal(preview.photo, "https://http2.mlstatic.com/D_NQ_NP_1-O.jpg");
      assert.match(preview.caption, /Mercado Livre · -25%/);
    } finally {
      f.restore();
    }
  });

  it("uses the typed price and text when the store blocks the page (Mercado Livre)", async () => {
    const cfg = testConfig();
    const link = `https://produto.mercadolivre.com.br/MLB-9${Date.now() % 1e8}-air-fryer-mondial-4l-_JM?matt_tool=123`;
    const f = mockFetch([
      ["mercadolivre.com.br", () => new Response("blocked", { status: 403 })],
      ["amzn.to", () => new Response("captcha", { status: 503 })],
      ["api.telegram.org", telegramRoute()],
      ["chat/completions", () => {
        throw new Error("AI must not be called when the admin wrote the text");
      }],
    ]);
    try {
      await say(cfg, link);
      assert.equal(await postByLink(link), undefined);
      assert.match(f.to("sendMessage").at(-1)!.body.text, /Não consegui ler o preço na página \(HTTP 403\)\. Mande de novo/);

      await say(cfg, `${link} 299 399,90\nA fritadeira que faltava 🍟`);
      const post = (await postByLink(link))!;
      assert.equal(post.marketplace, "mercadolivre");
      assert.equal(post.title, "air fryer mondial 4l");
      assert.deepEqual([post.price_cents, post.original_price_cents], [29900, 39990]);
      assert.equal(post.caption, "A fritadeira que faltava 🍟");
      assert.equal(post.ai_model, "manual");
      assert.match(f.to("sendMessage").filter((c) => c.body.chat_id === "111").at(-1)!.body.text, /Mercado Livre · -25%/);

      // amzn.to without a readable page or a name in the URL: first line under the link is the name.
      const short = `https://amzn.to/${suffix}`;
      await say(cfg, `${short} 59,90`);
      assert.match(f.to("sendMessage").at(-1)!.body.text, /nome do produto[\s\S]*Nome do produto/);
      await say(cfg, `${short} 59,90\nKit 3 Cuecas Boxer\nConforto nível sofá 🛋️`);
      const named = (await postByLink(short))!;
      assert.equal(named.title, "Kit 3 Cuecas Boxer");
      assert.equal(named.caption, "Conforto nível sofá 🛋️");

      await say(cfg, "https://shopee.com.br/produto-x 10");
      assert.match(f.to("sendMessage").at(-1)!.body.text, /Só aceito links da Amazon e do Mercado Livre/);
    } finally {
      f.restore();
    }
  });

  it("queues approved posts, spaces them, and lets the admin publish now or unschedule", async () => {
    const cfg = testConfig({ QUEUE_INTERVAL_MINUTES: "40", POSTING_HOURS: "0-24", X_MODE: "off", WHATSAPP_MODE: "off" });
    const f = mockFetch([["api.telegram.org", telegramRoute()], ["chat/completions", ai], ["affiliate.shopee", shortLink]]);
    const groupSends = () => f.calls.filter((c) => /sendPhoto|sendMessage/.test(c.url) && String(c.body.chat_id).startsWith("-100")).length;
    try {
      // Nothing went out recently and nothing waits in the queue (earlier tests or runs).
      await db.query(`UPDATE posts SET published_at = published_at - interval '1 day' WHERE published_at > now() - interval '1 day'`);
      await db.query(`UPDATE posts SET status = 'expired' WHERE status = 'queued'`);
      await collect(cfg, [offer("qa"), offer("qb", { externalId: `qb-${suffix}` })]);
      const a = await postFor("qa");
      const b = await postFor("qb");

      await tap(cfg, `a:${a.id}`);
      assert.equal((await postFor("qa")).status, "published", "empty queue: goes out right away");

      const sent = groupSends();
      await tap(cfg, `a:${b.id}`);
      assert.equal((await postFor("qb")).status, "queued");
      assert.equal(groupSends(), sent, "not sent yet");
      const edit = f.to("editMessage").filter((c) => c.body.message_id === Number(b.preview_message_id)).at(-1)!.body;
      assert.match(edit.caption ?? edit.text, /🕒 <b>#\d+ Agendado para (amanhã |\d\d\/\d\d )?\d\d:\d\d<\/b>/);
      assert.deepEqual(edit.reply_markup.inline_keyboard[0].map((k: { callback_data: string }) => k.callback_data), [`n:${b.id}`, `u:${b.id}`]);
      const at = (await db.query<{ gap: number }>(
        `SELECT extract(epoch FROM (b.scheduled_at - a.published_at))::int AS gap FROM posts a, posts b WHERE a.id = $1 AND b.id = $2`,
        [a.id, b.id],
      ))[0]!;
      assert.ok(Math.abs(at.gap - 40 * 60) < 5, `spaced by 40 min (got ${at.gap}s)`);

      await tap(cfg, `u:${b.id}`);
      assert.equal((await postFor("qb")).status, "pending", "unscheduled");
      await tap(cfg, `a:${b.id}`);
      assert.equal((await postFor("qb")).status, "queued");

      // The Worker's 5-minute cron publishes it once its time has come.
      const handler = createHandler(() => ({ cfg, db }));
      const cron = async () => {
        await handler.scheduled({ cron: "*/5 * * * *" }, {}, ctx);
        await flush();
      };
      await cron();
      assert.equal((await postFor("qb")).status, "queued", "not due yet");
      await db.query(`UPDATE posts SET scheduled_at = now() - interval '1 minute' WHERE id = $1`, [b.id]);
      await cron();
      assert.equal((await postFor("qb")).status, "queued", "overdue, but the last post went out minutes ago: keeps the spacing");
      await db.query(`UPDATE posts SET published_at = now() - interval '1 hour' WHERE published_at > now() - interval '1 hour'`);
      await cron();
      assert.equal((await postFor("qb")).status, "published");
      assert.equal(groupSends(), sent + 2, "one message per group");
      await tap(cfg, `n:${b.id}`);
      assert.equal(f.to("answerCallbackQuery").at(-1)!.body.text, "Esse post não está na fila.");
    } finally {
      f.restore();
    }
  });

  it("auto-approves big real discounts with AI text, and leaves the rest for the admin", async () => {
    const cfg = testConfig({ AUTO_APPROVE_MIN_DISCOUNT: "40", X_MODE: "off", WHATSAPP_MODE: "off" });
    const f = mockFetch([["api.telegram.org", telegramRoute()], ["chat/completions", ai], ["affiliate.shopee", shortLink]]);
    try {
      const res = await collect(cfg, [offer("auto-big", { discountPct: 50 }), offer("auto-small", { discountPct: 25, priceCents: 7500 })]);
      assert.equal(res.autoApproved, 1);
      assert.equal((await postFor("auto-big")).status, "published");
      assert.equal((await postFor("auto-small")).status, "pending");
    } finally {
      f.restore();
    }
    const noAi = mockFetch([["api.telegram.org", telegramRoute()], ["chat/completions", () => new Response("x", { status: 500 })], ["affiliate.shopee", shortLink]]);
    try {
      await collect(cfg, [offer("auto-template", { discountPct: 60 })]);
      assert.equal((await postFor("auto-template")).status, "pending", "template text is never auto-approved");
    } finally {
      noAi.restore();
    }
  });

  it("re-checks the price right before publishing", async () => {
    const cfg = testConfig({ X_MODE: "off", WHATSAPP_MODE: "off" });
    let now: unknown = { nodes: [] };
    const shopee = (c: { body: { query: string; variables: { input?: { subIds: string[] } } } }) =>
      c.body.query.includes("productOfferV2") ? { data: { productOfferV2: now } } : shortLink();
    const f = mockFetch([["api.telegram.org", telegramRoute()], ["chat/completions", ai], ["affiliate.shopee", shopee]]);
    const node = (id: string, price: string) => ({ itemId: Number(id), productName: "x", productLink: "https://shopee.com.br/p", priceMin: price, priceDiscountRate: 50 });
    try {
      const ids = { up: `9${Date.now() % 1e8}1`, down: `9${Date.now() % 1e8}2`, gone: `9${Date.now() % 1e8}3` };
      await collect(cfg, [
        offer("pc-up", { externalId: ids.up }),
        offer("pc-down", { externalId: ids.down }),
      ]);
      await collect(cfg, [offer("pc-gone", { externalId: ids.gone })]);
      const byExt = async (ext: string) =>
        (await db.query<{ id: number; status: string; price_cents: number; preview_message_id: string }>(
          `SELECT p.id, p.status, p.price_cents, p.preview_message_id::text FROM posts p JOIN products pr ON pr.id = p.product_id WHERE pr.external_id = $1 ORDER BY p.id DESC LIMIT 1`,
          [ext],
        ))[0]!;

      // Price went up R$ 50 -> R$ 65: not published, back to the admin.
      now = { nodes: [node(ids.up, "65.00")] };
      const up = await byExt(ids.up);
      await tap(cfg, `a:${up.id}`);
      assert.equal((await byExt(ids.up)).status, "pending");
      assert.equal((await byExt(ids.up)).price_cents, 6500);
      const edit = f.to("editMessage").filter((c) => c.body.message_id === Number(up.preview_message_id)).at(-1)!.body;
      assert.match(edit.caption ?? edit.text, /O preço subiu: R\$\s50,00 → R\$\s65,00/);
      assert.equal(edit.reply_markup.inline_keyboard[0][0].callback_data, `a:${up.id}`);
      await tap(cfg, `a:${up.id}`);
      assert.equal((await byExt(ids.up)).status, "published", "approved again at the new price");

      // Price went down: published with the better price.
      now = { nodes: [node(ids.down, "40.00")] };
      const down = await byExt(ids.down);
      await tap(cfg, `a:${down.id}`);
      assert.equal((await byExt(ids.down)).status, "published");
      const group = f.calls.filter((c) => /sendPhoto|sendMessage/.test(c.url) && c.body.chat_id === "-1001").at(-1)!.body;
      assert.match(group.caption ?? group.text, /<b>R\$\s40,00<\/b>/);

      // Gone from Shopee: not published.
      now = { nodes: [] };
      const gone = await byExt(ids.gone);
      await tap(cfg, `a:${gone.id}`);
      assert.equal((await byExt(ids.gone)).status, "expired");
    } finally {
      f.restore();
    }
  });

  it("edits the group messages when a published deal sells out or gets pricier", async () => {
    const cfg = testConfig({ X_MODE: "off", WHATSAPP_MODE: "off" });
    const answers = new Map<string, unknown>();
    const shopee = (c: { body: { query: string } }) => {
      const id = c.body.query.match(/itemId: (\d+)/)?.[1];
      return id ? { data: { productOfferV2: answers.get(id) ?? { nodes: [] } } } : shortLink();
    };
    const f = mockFetch([["api.telegram.org", telegramRoute()], ["chat/completions", ai], ["affiliate.shopee", shopee]]);
    const node = (id: string, price: string) => ({ itemId: Number(id), productName: "x", productLink: "https://shopee.com.br/p", priceMin: price, priceDiscountRate: 50 });
    try {
      // Nothing else of ours should be watched in this test.
      await db.query(`UPDATE posts SET deal_ended_at = now() WHERE deal_ended_at IS NULL`);
      const ids = { sold: `8${Date.now() % 1e8}1`, pricier: `8${Date.now() % 1e8}2`, fine: `8${Date.now() % 1e8}3` };
      for (const id of Object.values(ids)) answers.set(id, { nodes: [node(id, "50.00")] });
      await collect(cfg, [offer("end-sold", { externalId: ids.sold }), offer("end-up", { externalId: ids.pricier })]);
      await collect(cfg, [offer("end-fine", { externalId: ids.fine })]);
      const posts = await db.query<{ id: number; ext: string }>(
        `SELECT p.id, pr.external_id AS ext FROM posts p JOIN products pr ON pr.id = p.product_id WHERE pr.external_id = ANY($1::text[])`,
        [Object.values(ids)],
      );
      for (const p of posts) await tap(cfg, `a:${p.id}`);
      const msgIdOf = async (id: number) =>
        Number((await db.query<{ m: string }>(`SELECT external_id AS m FROM publications WHERE post_id = $1 AND target = '-1001' AND status = 'sent'`, [id]))[0]!.m);
      const idOf = (ext: string) => posts.find((p) => p.ext === ext)!.id;

      answers.set(ids.sold, { nodes: [] });
      answers.set(ids.pricier, { nodes: [node(ids.pricier, "59.90")] });
      answers.set(ids.fine, { nodes: [node(ids.fine, "51.00")] });
      const before = f.to("editMessage").length;
      const res = await collect(cfg, []);
      assert.equal(res.ended, 2);
      const edits = f.to("editMessage").slice(before);
      const textFor = async (id: number) => {
        const m = await msgIdOf(id);
        return edits.filter((c) => c.body.message_id === m && c.body.chat_id === "-1001").map((c) => c.body.caption ?? c.body.text).at(-1) ?? "";
      };
      assert.match(await textFor(idOf(ids.sold)), /^❌ <b>ESGOTOU<\/b>/);
      assert.match(await textFor(idOf(ids.pricier)), /^⚠️ <b>O preço subiu<\/b>: agora R\$\s59,90/);
      assert.equal(await textFor(idOf(ids.fine)), "", "2% up is not an ended deal");
      assert.equal(edits.filter((c) => c.body.chat_id === "-1002").length, 2, "every group gets the banner");

      const again = await collect(cfg, []);
      assert.equal(again.ended, 0, "flagged once");
    } finally {
      f.restore();
    }
  });

  it("serves a public page with the live deals and their own tracked links", async () => {
    const cfg = testConfig({ X_MODE: "off", WHATSAPP_MODE: "off", SITE_NAME: "Dev das Promos", SITE_TELEGRAM_URL: "https://t.me/+abc", SITE_X_URL: "https://x.com/devdaspromocoes" });
    const f = mockFetch([["api.telegram.org", telegramRoute()], ["chat/completions", ai], ["affiliate.shopee", shortLink]]);
    try {
      await collect(cfg, [offer("site-live", { title: "Fone <b>JBL</b> & Cia" }), offer("site-ended", { title: "Mouse Encerrado" })]);
      for (const name of ["site-live", "site-ended"]) await tap(cfg, `a:${(await postFor(name)).id}`);
      await db.query(`UPDATE posts SET deal_ended_at = now() WHERE id = $1`, [(await postFor("site-ended")).id]);

      const handler = createHandler(() => ({ cfg, db }));
      const page = await handler.fetch(new Request("https://w/"), {}, ctx);
      assert.equal(page.status, 200);
      assert.match(page.headers.get("content-type")!, /text\/html/);
      const html = await page.text();
      assert.ok(html.includes("Fone &lt;b&gt;JBL&lt;/b&gt; &amp; Cia"), "titles are escaped");
      assert.ok(!html.includes("Mouse Encerrado"), "ended deals are hidden");
      assert.ok(html.includes('href="https://t.me/+abc"'));
      assert.ok(html.includes('href="https://x.com/devdaspromocoes"'), "X profile button");
      assert.match(html, /<img class="banner" src="\/banner\.webp"/);
      assert.ok(html.includes(`content="${cfg.publicBaseUrl}/og.jpg"`), "link previews use the banner");
      assert.ok(!html.includes("Grupo no WhatsApp"), "no WhatsApp button without a link");
      assert.match(html, /#publi/);
      const live = (await postFor("site-live")).id;
      const web = await db.query<{ code: string }>(`SELECT code FROM links WHERE post_id = $1 AND channel = 'web'`, [live]);
      assert.equal(web.length, 1);
      assert.ok(html.includes(`/go/${web[0]!.code}`));
      await handler.fetch(new Request("https://w/ofertas"), {}, ctx);
      assert.equal((await db.query(`SELECT 1 FROM links WHERE post_id = $1 AND channel = 'web'`, [live])).length, 1, "one link per deal");

      // Growth: the source of the visit, visit counts, share links, badge, sticky join bar.
      const browser = { "user-agent": "Mozilla/5.0 (iPhone)" };
      const todayViews = async () =>
        Object.fromEntries(
          (await db.query<{ source: string; views: number }>(
            `SELECT source, views FROM site_views WHERE day = (now() AT TIME ZONE 'America/Sao_Paulo')::date`,
          )).map((v) => [v.source, v.views]),
        ) as Record<string, number>;
      const viewsBefore = await todayViews();
      const fromX = await (await handler.fetch(new Request("https://w/?src=x", { headers: browser }), {}, ctx)).text();
      await handler.fetch(new Request("https://w/?src=junk-123", { headers: browser }), {}, ctx);
      await handler.fetch(new Request("https://w/", { headers: { "user-agent": "TelegramBot (like TwitterBot)" } }), {}, ctx);
      await flush();
      const xCode = (await db.query<{ code: string }>(`SELECT code FROM links WHERE post_id = $1 AND channel = 'web' AND target = 'x'`, [live]))[0]!.code;
      assert.ok(fromX.includes(`/go/${xCode}`), "visits from X get their own links");
      assert.equal((await db.query(`SELECT 1 FROM links WHERE post_id = $1 AND channel = 'web' AND target = 'other'`, [live])).length, 1);
      const viewsAfter = await todayViews();
      const added = (src: string) => (viewsAfter[src] ?? 0) - (viewsBefore[src] ?? 0);
      assert.deepEqual([added("x"), added("other"), added("")], [1, 1, 0], "one visit each; the robot isn't counted");
      assert.ok(fromX.includes(encodeURIComponent("https://promo.example.workers.dev/?src=share#oferta-")), "share links point to the site");
      assert.ok(!/wa\.me\/\?text=[^"]*s\.shopee/.test(fromX), "never the affiliate link");
      assert.match(fromX, /class="sticky"/);
      assert.match(fromX, /Checamos o histórico de preço/);
      assert.match(await (await handler.fetch(new Request("https://w/robots.txt"), {}, ctx)).text(), /Disallow: \/go\//);
      assert.equal(await (await handler.fetch(new Request("https://w/health"), {}, ctx)).text(), "ok");
    } finally {
      f.restore();
    }
  });

  it("builds the weekly Top 10, sends it to every group with their own links, once", async () => {
    const cfg = testConfig({ X_MODE: "off" });
    const f = mockFetch([["api.telegram.org", telegramRoute()], ["chat/completions", ai], ["affiliate.shopee", shortLink]]);
    try {
      await collect(cfg, [offer("top-1"), offer("top-2", { externalId: `top-2-${suffix}` })]);
      await collect(cfg, [offer("top-3")]);
      for (const name of ["top-1", "top-2", "top-3"]) await tap(cfg, `a:${(await postFor(name)).id}`);

      const handler = createHandler(() => ({ cfg, db }));
      await handler.scheduled({ cron: "0 21 * * SUN" }, {}, ctx);
      await flush();
      const preview = f.to("sendMessage").filter((c) => c.body.chat_id === "111").at(-1)!.body;
      assert.match(preview.text, /Resumo #\d+<\/b> · prévia/);
      assert.match(preview.text, /🔥 <b>Top \d+ da semana<\/b>/);
      assert.match(preview.text, /Produto top-1/);
      const id = Number(preview.reply_markup.inline_keyboard[0][0].callback_data.split(":")[1]);

      const before = f.to("sendMessage").length;
      await tap(cfg, `w:${id}`);
      await tap(cfg, `w:${id}`);
      const sent = f.to("sendMessage").slice(before).filter((c) => String(c.body.chat_id).startsWith("-100"));
      assert.deepEqual(sent.map((c) => c.body.chat_id).sort(), ["-1001", "-1002"], "once per group, even if tapped twice");
      const codesIn = (text: string) => [...text.matchAll(/\/go\/([0-9a-zA-Z]+)/g)].map((m) => m[1]);
      const [g1, g2] = [sent.find((c) => c.body.chat_id === "-1001")!, sent.find((c) => c.body.chat_id === "-1002")!];
      assert.ok(codesIn(g1.body.text).length >= 3);
      assert.ok(codesIn(g1.body.text).every((c) => !codesIn(g2.body.text).includes(c)), "each group has its own links");
      assert.match(g1.body.text, /#publi/);

      const wa = await handler.fetch(new Request(`https://w/wr/${id}`), {}, ctx);
      assert.equal(wa.status, 302);
      assert.match(new URL(wa.headers.get("location")!).searchParams.get("text")!, /^🔥 \*Top \d+ da semana\*/);
      assert.equal((await handler.fetch(new Request("https://w/wr/999999"), {}, ctx)).status, 404);
    } finally {
      f.restore();
    }
  });

  it("gives template previews an AI text on a later try", async () => {
    const cfg = testConfig();
    let aiUp = false;
    const f = mockFetch([
      ["api.telegram.org", telegramRoute()],
      ["chat/completions", () => (aiUp ? ai() : new Response("{}", { status: 429 }))],
      ["affiliate.shopee", shortLink],
    ]);
    try {
      await collect(cfg, [offer("heal")]);
      const post = await postFor("heal");
      const model = async () => (await db.query<{ ai_model: string; caption: string }>(`SELECT ai_model, caption FROM posts WHERE id = $1`, [post.id]))[0]!;
      assert.equal((await model()).ai_model, "template");
      aiUp = true;
      const healed = await healTemplateCaptions(cfg, db, () => {}, 50);
      assert.ok(healed >= 1);
      assert.equal((await model()).caption, "Texto da IA");
      const edit = f.to("editMessage").filter((c) => c.body.message_id === Number(post.preview_message_id)).at(-1)!.body;
      assert.match(edit.caption ?? edit.text, /Texto da IA/);
      assert.equal(edit.reply_markup.inline_keyboard[0][0].callback_data, `a:${post.id}`, "still a normal preview");
    } finally {
      f.restore();
    }
  });

  it("posts to X as a thread: photo + no link, then a reply with the link, within the limits", async () => {
    const cfg = testConfig({ X_MODE: "thread", X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c", X_ACCESS_TOKEN_SECRET: "d", X_DAILY_POSTS: "2", WHATSAPP_MODE: "off" });
    let tweet = 0;
    const f = mockFetch([
      ["img.test", () => new Response(new Uint8Array(5000), { headers: { "content-type": "image/jpeg" } })],
      ["api.x.com/2/media/upload", () => ({ data: { id: "media-1" } })],
      ["api.x.com/2/tweets", () => ({ data: { id: `tw-${++tweet}` } })],
      ["api.telegram.org", telegramRoute()],
      ["chat/completions", ai],
      ["affiliate.shopee", shortLink],
    ]);
    try {
      // Earlier runs' X spend belongs to an earlier month as far as this test is concerned.
      await db.query(`UPDATE x_usage SET created_at = created_at - interval '40 days'`);
      await collect(cfg, [offer("xt-1", { imageUrl: "https://img.test/a.jpg" }), offer("xt-2", { title: "Fone Bluetooth Comum" })]);
      await collect(cfg, [offer("xt-3", { title: "Placa de Vídeo RTX 5060 8GB" }), offer("xt-4", { title: "Processador Ryzen 5 9600X" })]);
      for (const name of ["xt-1", "xt-2", "xt-3", "xt-4"]) await tap(cfg, `a:${(await postFor(name)).id}`);

      const tweets = f.to("api.x.com/2/tweets").map((c) => c.body);
      assert.equal(tweets.length, 3, "first deal: post + reply; non-hardware Shopee skipped; hardware Shopee: post only; then the daily limit");
      assert.deepEqual(tweets[0].media, { media_ids: ["media-1"] }, "with the product photo");
      assert.ok(!tweets[0].text.includes("http"), "main post has no link");
      assert.match(tweets[0].text, /primeiro comentário/);
      assert.equal(tweets[1].reply.in_reply_to_tweet_id, "tw-1");
      assert.match(tweets[1].text, /\/go\/[0-9a-zA-Z]+/);
      assert.match(tweets[2].text, /Placa de Vídeo/);
      assert.ok(!tweets[2].reply, "budget left for a post, not for another link reply");
      assert.match(tweets[2].text, /Link na bio/);
      const edit = (name: string) => postFor(name).then((p) => f.to("editMessage").filter((c) => c.body.message_id === Number(p.preview_message_id)).at(-1)!.body);
      assert.match((await edit("xt-2")).text ?? "", /Fora desta vez: X \(já teve Shopee hoje/);
      assert.match((await edit("xt-4")).text ?? "", /limite de 2 posts por dia/);
      const spent = await db.query<{ n: number; usd: string }>(
        `SELECT count(*)::int AS n, sum(cost_usd)::text AS usd FROM x_usage WHERE created_at > now() - interval '1 day'`,
      );
      assert.deepEqual([spent[0]!.n, Number(spent[0]!.usd)], [3, 0.23]);
    } finally {
      f.restore();
    }
  });

  it("lets the admin write the post text with ✏️, also while the post waits in the queue", async () => {
    const cfg = testConfig({ QUEUE_INTERVAL_MINUTES: "40", POSTING_HOURS: "0-24", X_MODE: "off", WHATSAPP_MODE: "off" });
    const f = mockFetch([["api.telegram.org", telegramRoute()], ["chat/completions", ai], ["affiliate.shopee", shortLink]]);
    const reply = async (text: string, to: { message_id: number; text?: string }) => {
      await createHandler(() => ({ cfg, db })).fetch(
        new Request("https://w/telegram/webhook", {
          method: "POST",
          headers: { "x-telegram-bot-api-secret-token": "secret_secret_secret" },
          body: JSON.stringify({ update_id: 1, message: { message_id: 77, chat: { id: 111, type: "private" }, from: { id: 111 }, text, reply_to_message: to } }),
        }),
        {},
        ctx,
      );
      await flush();
    };
    const caption = async (id: number) => (await db.query<{ caption: string; ai_model: string }>(`SELECT caption, ai_model FROM posts WHERE id = $1`, [id]))[0]!;
    try {
      await collect(cfg, [offer("own-1")]);
      const post = await postFor("own-1");
      const kb = f.to("sendMessage").filter((c) => c.body.chat_id === "111").at(-1)!.body.reply_markup.inline_keyboard;
      assert.equal(kb[1][1].callback_data, `e:${post.id}`, "✏️ button on the preview");

      await tap(cfg, `e:${post.id}`);
      const prompt = f.to("sendMessage").at(-1)!.body;
      assert.equal(prompt.reply_markup.force_reply, true);
      await reply("Seu setup agradece 🎮", { message_id: 900, text: prompt.text });
      assert.deepEqual(await caption(post.id), { caption: "Seu setup agradece 🎮", ai_model: "manual" });

      // Still editable after approval, while it waits for its slot.
      await db.query(`UPDATE posts SET published_at = now() WHERE id = (SELECT max(id) FROM posts WHERE id <> $1 AND status = 'published')`, [post.id]);
      await tap(cfg, `a:${post.id}`);
      assert.equal((await postFor("own-1")).status, "queued");
      await reply("Agora com outro texto 😎", { message_id: Number(post.preview_message_id) });
      assert.equal((await caption(post.id)).caption, "Agora com outro texto 😎");
      const edit = f.to("editMessage").filter((c) => c.body.message_id === Number(post.preview_message_id)).at(-1)!.body;
      assert.match(edit.caption ?? edit.text, /🕒 <b>#\d+ Agendado para/, "keeps its slot header");
      assert.equal(edit.reply_markup.inline_keyboard[0][0].callback_data, `n:${post.id}`, "keeps the queue buttons");
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
