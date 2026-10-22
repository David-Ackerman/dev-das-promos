/**
 * Product photos: the white-background / text check, the AI scene, and the
 * whole path through preview → /img → groups. Store, AI and Telegram are mocked.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { runCollect } from "../src/collect.ts";
import { createNodeDb } from "../src/db-node.ts";
import { createHandler } from "../src/http.ts";
import { decideImage, fromBase64, parsePhotoCheck, scenePrompt, toBase64 } from "../src/images.ts";
import { migrate } from "../src/migrate.ts";
import type { Candidate } from "../src/types.ts";
import { type Call, mockFetch, testConfig } from "./helpers.ts";

const JPEG = new Uint8Array(5000).fill(7);
const GENERATED = new Uint8Array(6000).fill(9);
const photoRoute = () => new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
const checkRoute = (white: boolean, text = false) => (c: Call) =>
  Array.isArray(c.body?.messages?.[1]?.content)
    ? { choices: [{ message: { content: JSON.stringify({ white_background: white, too_much_text: text, scene: "gamer desk setup with RGB lights" }) } }] }
    : { choices: [{ message: { content: '{"texto":"Esse teclado vai melhorar sua gameplay","tweet":"GG"}' } }] };
const geminiRoute = () => ({ candidates: [{ content: { parts: [{ text: "ok" }, { inlineData: { mimeType: "image/png", data: toBase64(GENERATED) } }] } }] });

const imageEnv = { IMAGE_MODEL: "gemini:gemini-3.1-flash-lite-image", GEMINI_API_KEY: "g-key", AI_MODEL: "gemini:gemini-flash-latest" };
const product = { title: "Teclado Mecânico Redragon", imageUrl: "https://cdn.store/teclado.jpg", marketplace: "shopee" };
const none = { generatedToday: async () => 0 };

describe("photo check", () => {
  it("parses the vision model's JSON", () => {
    assert.deepEqual(parsePhotoCheck('```json\n{"white_background": true, "too_much_text": "false", "scene": "modern kitchen"}\n```'), {
      whiteBackground: true,
      tooMuchText: false,
      scene: "modern kitchen",
    });
    assert.throws(() => parsePhotoCheck("no idea"));
  });
  it("asks for the same product in its scene, with no text", () => {
    const p = scenePrompt("Air Fryer Mondial", "modern kitchen countertop");
    assert.match(p, /EXACT product/);
    assert.match(p, /modern kitchen countertop/);
    assert.match(p, /Do NOT add any text/);
  });
  it("base64 round-trips", () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 251);
    assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
  });
});

describe("decideImage", () => {
  it("keeps a good store photo", async () => {
    const f = mockFetch([["cdn.store", photoRoute], ["chat/completions", checkRoute(false)]]);
    try {
      const cfg = testConfig(imageEnv);
      assert.deepEqual(await decideImage(cfg.ai, cfg.images, product, none), { kind: "store" });
      assert.equal(f.to("generateContent").length, 0, "no paid image call");
    } finally {
      f.restore();
    }
  });
  it("replaces a white background with an AI scene", async () => {
    const f = mockFetch([["cdn.store", photoRoute], ["chat/completions", checkRoute(true)], ["generateContent", geminiRoute]]);
    try {
      const cfg = testConfig(imageEnv);
      const d = await decideImage(cfg.ai, cfg.images, product, none);
      assert.equal(d.kind, "generated");
      if (d.kind !== "generated") return;
      assert.deepEqual(d.image.bytes, GENERATED);
      assert.equal(d.image.mime, "image/png");
      assert.match(d.note, /fundo branco/);
      const call = f.to("generateContent")[0]!;
      assert.match(call.url, /models\/gemini-3\.1-flash-lite-image:generateContent$/);
      assert.equal(call.headers["x-goog-api-key"], "g-key");
      assert.match(call.body.contents[0].parts[0].text, /gamer desk setup with RGB lights/);
      assert.equal(call.body.contents[0].parts[1].inline_data.data, toBase64(JPEG));
    } finally {
      f.restore();
    }
  });
  it("replaces text-heavy photos too, and works through OpenRouter", async () => {
    const out = `data:image/jpeg;base64,${toBase64(GENERATED)}`;
    const f = mockFetch([
      ["cdn.store", photoRoute],
      ["generativelanguage", checkRoute(false, true)],
      ["openrouter.ai", () => ({ choices: [{ message: { images: [{ image_url: { url: out } }] } }] })],
    ]);
    try {
      const cfg = testConfig({ ...imageEnv, IMAGE_MODEL: "openrouter:google/gemini-2.5-flash-image", OPENROUTER_API_KEY: "or" });
      const d = await decideImage(cfg.ai, cfg.images, product, none);
      assert.equal(d.kind, "generated");
      assert.match((d as { note: string }).note, /muito texto/);
      assert.deepEqual(f.to("openrouter.ai")[0]!.body.modalities, ["image", "text"]);
    } finally {
      f.restore();
    }
  });
  it("Amazon photos are white without asking; limits and failures keep the store photo", async () => {
    const f = mockFetch([["cdn.store", photoRoute], ["chat/completions", () => new Response("busy", { status: 503 })], ["generateContent", () => new Response("{}", { status: 400 })]]);
    try {
      const cfg = testConfig(imageEnv);
      const amazon = { ...product, marketplace: "amazon" };
      const failed = await decideImage(cfg.ai, cfg.images, amazon, none);
      assert.equal(failed.kind, "store");
      assert.match((failed as { note: string }).note, /falhou/);
      assert.equal(f.to("generateContent").length, 1, "tried even though the check failed");
      const limited = await decideImage(cfg.ai, cfg.images, amazon, { generatedToday: async () => 20 });
      assert.match((limited as { note: string }).note, /limite de 20/);
      // Shopee + failed check = we don't know it's bad: keep it, no paid call.
      assert.deepEqual(await decideImage(cfg.ai, cfg.images, product, none), { kind: "store" });
    } finally {
      f.restore();
    }
  });
  it("does nothing without IMAGE_MODEL", async () => {
    const f = mockFetch([]);
    try {
      const cfg = testConfig();
      assert.deepEqual(await decideImage(cfg.ai, cfg.images, product, none), { kind: "store" });
      assert.equal(f.calls.length, 0);
    } finally {
      f.restore();
    }
  });
});

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

describe("AI photo end to end", { skip: !hasDb && "no test database" }, () => {
  const db = createNodeDb(DB_URL);
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
  const flush = async () => {
    while (waits.length) await waits.shift();
  };
  before(() => migrate(DB_URL, () => {}));
  after(() => db.close());

  it("preview gets the AI scene, groups get it via /img, ↩️ brings the store photo back", async () => {
    const suffix = Date.now().toString(36);
    let msg = Date.now() % 1_000_000_000;
    const tgRoute = (c: Call) => {
      const photo = [{ file_id: `small-${msg}`, width: 90 }, { file_id: `big-${msg + 1}`, width: 1280 }];
      if (/editMessageMedia/.test(c.url)) return { ok: true, result: { message_id: 1, photo } };
      if (/getFile/.test(c.url)) return { ok: true, result: { file_path: "photos/file_1.jpg" } };
      return { ok: true, result: { message_id: ++msg, photo } };
    };
    const f = mockFetch([
      ["api.telegram.org/file/", () => new Response(GENERATED, { headers: { "content-type": "application/octet-stream" } })],
      ["api.telegram.org", tgRoute],
      ["cdn.store", photoRoute],
      ["chat/completions", checkRoute(true)],
      ["generateContent", geminiRoute],
      ["affiliate.shopee", () => ({ data: { generateShortLink: { shortLink: "https://s.shopee.com.br/x" } } })],
      ["api.github.com", () => new Response(null, { status: 204 })],
    ]);
    try {
      const cfg = testConfig({ ...imageEnv, POSTS_PER_RUN: "1", GH_DISPATCH_TOKEN: "t", GH_REPO: "me/repo" });
      const offer: Candidate = {
        marketplace: "shopee", externalId: `img-${suffix}`, title: "Teclado Mecânico Redragon", imageUrl: "https://cdn.store/teclado.jpg",
        productUrl: "https://shopee.com.br/p/7", priceCents: 15000, originalPriceCents: 30000, discountPct: 50,
      };
      const res = await runCollect(cfg, db, { fetchShopee: async () => [offer], log: () => {} });
      assert.equal(res.previews, 1);
      const upload = f.to("sendPhoto").find((c) => c.body instanceof FormData)!;
      assert.ok(upload, "the AI image was uploaded with the preview");
      const form = upload.body as FormData;
      assert.equal(form.get("chat_id"), "111");
      assert.match(String(form.get("caption")), /🖼️ imagem de IA \(foto da loja com fundo branco\)/);
      assert.match(String(form.get("reply_markup")), /↩️ Foto da loja/);

      const [post] = await db.query<{ id: number; image_url: string; image_file_id: string; image_source: string }>(
        `SELECT p.id, p.image_url, p.image_file_id, p.image_source FROM posts p JOIN products pr ON pr.id = p.product_id WHERE pr.external_id = $1`,
        [`img-${suffix}`],
      );
      assert.equal(post!.image_source, "generated");
      assert.match(post!.image_file_id, /^big-/);
      assert.equal(post!.image_url, `${cfg.publicBaseUrl}/img/${post!.id}.jpg`);

      // /img streams the photo from Telegram without exposing the token
      const handler = createHandler(() => ({ cfg, db }));
      const img = await handler.fetch(new Request(`https://w/img/${post!.id}.jpg`), {}, ctx);
      assert.equal(img.status, 200);
      assert.equal(img.headers.get("content-type"), "image/jpeg");
      assert.deepEqual(new Uint8Array(await img.arrayBuffer()), GENERATED);
      assert.equal((await handler.fetch(new Request("https://w/img/999999999"), {}, ctx)).status, 404);

      const hook = (update: unknown) =>
        handler.fetch(
          new Request("https://w/telegram/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "secret_secret_secret" }, body: JSON.stringify(update) }),
          {},
          ctx,
        );
      // 🖼️ Nova imagem → GitHub workflow
      await hook({ update_id: 1, callback_query: { id: "g", from: { id: 111 }, data: `g:${post!.id}` } });
      await flush();
      const dispatch = f.to("api.github.com").at(-1)!;
      assert.match(dispatch.url, /workflows\/image\.yml\/dispatches$/);
      assert.deepEqual(dispatch.body.inputs, { post_id: String(post!.id), mode: "force" });

      // Approve → the groups get our photo
      await hook({ update_id: 2, callback_query: { id: "a", from: { id: 111 }, data: `a:${post!.id}` } });
      await flush();
      const groupPhotos = f.to("sendPhoto").filter((c) => !(c.body instanceof FormData) && String(c.body.chat_id).startsWith("-100"));
      assert.equal(groupPhotos.length, 2);
      assert.equal(groupPhotos[0]!.body.photo, post!.image_url);
    } finally {
      f.restore();
    }
  });

  it("↩️ Foto da loja puts the store photo back on a pending preview", async () => {
    const suffix = Date.now().toString(36);
    let msg = Date.now() % 1_000_000_000;
    const f = mockFetch([
      ["api.telegram.org", (c: Call) => ({ ok: true, result: { message_id: ++msg, photo: [{ file_id: `f-${msg}`, width: 800 }] } })],
      ["cdn.store", photoRoute],
      ["chat/completions", checkRoute(true)],
      ["generateContent", geminiRoute],
      ["affiliate.shopee", () => ({ data: { generateShortLink: { shortLink: "https://s.shopee.com.br/y" } } })],
    ]);
    try {
      const cfg = testConfig({ ...imageEnv, POSTS_PER_RUN: "1" });
      const offer: Candidate = {
        marketplace: "shopee", externalId: `back-${suffix}`, title: "Mouse Gamer", imageUrl: "https://cdn.store/mouse.jpg",
        productUrl: "https://shopee.com.br/p/8", priceCents: 9000, originalPriceCents: 18000, discountPct: 50,
      };
      await runCollect(cfg, db, { fetchShopee: async () => [offer], log: () => {} });
      const [post] = await db.query<{ id: number }>(`SELECT p.id FROM posts p JOIN products pr ON pr.id = p.product_id WHERE pr.external_id = $1`, [`back-${suffix}`]);
      const handler = createHandler(() => ({ cfg, db }));
      await handler.fetch(
        new Request("https://w/telegram/webhook", {
          method: "POST",
          headers: { "x-telegram-bot-api-secret-token": "secret_secret_secret" },
          body: JSON.stringify({ update_id: 3, callback_query: { id: "o", from: { id: 111 }, data: `o:${post!.id}` } }),
        }),
        {},
        ctx,
      );
      await flush();
      const edit = f.to("editMessageMedia").at(-1)!;
      assert.equal(JSON.parse(String((edit.body as FormData).get("media"))).media, "https://cdn.store/mouse.jpg");
      const [row] = await db.query<{ image_url: string | null; image_source: string | null }>(`SELECT image_url, image_source FROM posts WHERE id = $1`, [post!.id]);
      assert.deepEqual(row, { image_url: null, image_source: null });
    } finally {
      f.restore();
    }
  });
});
