import { handleUpdate, type TgUpdate, triggerCollect } from "./bot.ts";
import type { Config, Env } from "./config.ts";
import type { Db } from "./db.ts";
import { goUrl } from "./publish.ts";
import { getPost, recordClick, resolveLink } from "./repo.ts";
import { sendText } from "./telegram.ts";
import { whatsappShareUrl, xShareUrl } from "./share.ts";
import { isValidCode, sha256Hex } from "./util.ts";

/**
 * Cloudflare Worker (free plan). Routes:
 *   GET  /go/:code          tracked redirect to the affiliate link (logs the click)
 *   GET  /wa/:code          opens WhatsApp with the post text ready to send
 *   GET  /x/:code           opens X with the post text ready to send
 *   POST /telegram/webhook  your bot's buttons and commands
 *   GET  /health
 * Plus a cron (wrangler.toml) that starts the "Collect deals" workflow on time,
 * because GitHub's own schedule runs hours late or not at all.
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
      if (go && (request.method === "GET" || request.method === "HEAD")) {
        const code = go[1] as string;
        if (!isValidCode(code)) return new Response("Not found", { status: 404 });
        const { db, cfg } = getDeps(env);
        const link = await resolveLink(db, code);
        if (!link) return new Response("Link não encontrado", { status: 404 });
        // Link checkers probe with HEAD: answer like GET, but it isn't a click.
        if (request.method === "HEAD") return Response.redirect(link.affiliate_url, 302);
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

      const share = path.match(/^\/(wa|x)\/([^/]+)$/);
      if (share && request.method === "GET") {
        const channel = share[1] === "wa" ? "whatsapp" : "x";
        const code = share[2] as string;
        if (!isValidCode(code)) return new Response("Not found", { status: 404 });
        const { db, cfg } = getDeps(env);
        const link = await resolveLink(db, code);
        if (!link || link.channel !== channel) return new Response("Not found", { status: 404 });
        const post = await getPost(db, link.post_id);
        if (!post) return new Response("Not found", { status: 404 });
        const url = channel === "whatsapp" ? whatsappShareUrl(cfg, post, goUrl(cfg, code)) : xShareUrl(cfg, post, goUrl(cfg, code));
        return Response.redirect(url, 302);
      }

      if (path === "/telegram/webhook" && request.method === "POST") {
        const { db, cfg } = getDeps(env);
        const secret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        if (!cfg.telegram.webhookSecret || secret !== cfg.telegram.webhookSecret) {
          return new Response("forbidden", { status: 403 });
        }
        const update = (await request.json().catch(() => undefined)) as TgUpdate | undefined;
        if (!update || typeof update !== "object") return new Response("bad request", { status: 400 });
        // Answer Telegram right away; do the work in the background.
        ctx.waitUntil(handleUpdate(cfg, db, update));
        return new Response("ok");
      }

      return new Response("Not found", { status: 404 });
    },

    async scheduled(_event: unknown, env: Env, ctx: Ctx): Promise<void> {
      const { cfg } = getDeps(env);
      ctx.waitUntil(
        (async () => {
          const result = await triggerCollect(cfg).catch((e: unknown) => ({ ok: false, message: String(e) }));
          if (!result.ok) {
            console.error("scheduled collect failed", result.message);
            await sendText(cfg.telegram.botToken, cfg.telegram.adminChatId, `⚠️ Busca agendada: ${result.message}`).catch(() => {});
          }
        })(),
      );
    },
  };
}
