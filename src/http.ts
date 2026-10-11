import { handleUpdate, type TgUpdate } from "./bot.ts";
import type { Config, Env } from "./config.ts";
import type { Db } from "./db.ts";
import { renderInput } from "./preview.ts";
import { goUrl } from "./publish.ts";
import { renderWhatsApp } from "./render.ts";
import { shareUrl } from "./publishers/whatsapp.ts";
import { getPost, recordClick, resolveLink } from "./repo.ts";
import { isValidCode, sha256Hex } from "./util.ts";

/**
 * Cloudflare Worker (free plan). Routes:
 *   GET  /go/:code          tracked redirect to the affiliate link (logs the click)
 *   GET  /wa/:code          opens WhatsApp with the post text ready to send
 *   POST /telegram/webhook  your bot's buttons and commands
 *   GET  /health
 */
interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

export const BOT_UA =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|twitter|discord|slack|skype|headless|curl|wget|python|axios|node-fetch/i;

export function createHandler(getDeps: (env: Env) => { cfg: Config; db: Db }) {
  return {
    async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (path === "/" || path === "/health") return new Response("ok");

      const go = path.match(/^\/go\/([^/]+)$/);
      if (go && request.method === "GET") {
        const code = go[1] as string;
        if (!isValidCode(code)) return new Response("Not found", { status: 404 });
        const { db, cfg } = getDeps(env);
        const link = await resolveLink(db, code);
        if (!link) return new Response("Link não encontrado", { status: 404 });
        const ua = request.headers.get("user-agent") ?? "";
        const ip = request.headers.get("cf-connecting-ip") ?? "";
        ctx.waitUntil(
          (async () => {
            await recordClick(db, {
              code,
              isBot: !ua || BOT_UA.test(ua),
              country: request.headers.get("cf-ipcountry") ?? undefined,
              userAgent: ua,
              referer: request.headers.get("referer") ?? undefined,
              ipHash: ip ? (await sha256Hex(`${ip}|${cfg.telegram.webhookSecret}`)).slice(0, 16) : undefined,
            });
          })().catch((e) => console.error("click log failed", e)),
        );
        return Response.redirect(link.affiliate_url, 302);
      }

      const wa = path.match(/^\/wa\/([^/]+)$/);
      if (wa && request.method === "GET") {
        const code = wa[1] as string;
        if (!isValidCode(code)) return new Response("Not found", { status: 404 });
        const { db, cfg } = getDeps(env);
        const link = await resolveLink(db, code);
        if (!link || link.channel !== "whatsapp") return new Response("Not found", { status: 404 });
        const post = await getPost(db, link.post_id);
        if (!post) return new Response("Not found", { status: 404 });
        const text = renderWhatsApp(renderInput(cfg, post, goUrl(cfg, code)));
        return Response.redirect(shareUrl(text), 302);
      }

      if (path === "/telegram/webhook" && request.method === "POST") {
        const { db, cfg } = getDeps(env);
        const secret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        if (!cfg.telegram.webhookSecret || secret !== cfg.telegram.webhookSecret) {
          return new Response("forbidden", { status: 403 });
        }
        const update = (await request.json()) as TgUpdate;
        // Answer Telegram right away; do the work in the background.
        ctx.waitUntil(handleUpdate(cfg, db, update));
        return new Response("ok");
      }

      return new Response("Not found", { status: 404 });
    },
  };
}
