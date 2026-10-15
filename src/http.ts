import { handleUpdate, type TgUpdate, triggerCollect } from "./bot.ts";
import type { Config, Env } from "./config.ts";
import type { Db } from "./db.ts";
import { goUrl, publishDue } from "./publish.ts";
import { getPost, recordClick, resolveLink, siteDeals } from "./repo.ts";
import { sendText } from "./telegram.ts";
import { whatsappShareUrl, xSharePage, xShareText } from "./share.ts";
import { ROBOTS_TXT, sitePage } from "./site.ts";
import { isValidCode, sha256Hex } from "./util.ts";

/**
 * Cloudflare Worker (free plan). Routes:
 *   GET  /, /ofertas        public page with the live deals
 *   GET  /go/:code          tracked redirect to the affiliate link (logs the click)
 *   GET  /wa/:code          opens WhatsApp with the post text ready to send
 *   GET  /x/:code           page to copy the X post or open it in the X app
 *   POST /telegram/webhook  your bot's buttons and commands
 *   GET  /health
 * Plus crons (wrangler.toml): QUEUE_CRON publishes queued posts when their time
 * comes; the others start the "Collect deals" workflow on time, because GitHub's
 * own schedule runs hours late or not at all.
 */
export const QUEUE_CRON = "*/5 * * * *";
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

      if (path === "/health") return new Response("ok");
      if (path === "/robots.txt") return new Response(ROBOTS_TXT, { headers: { "content-type": "text/plain; charset=utf-8" } });
      if ((path === "/" || path === "/ofertas") && (request.method === "GET" || request.method === "HEAD")) {
        const { db, cfg } = getDeps(env);
        return new Response(sitePage(cfg, await siteDeals(db, 7, 60)), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
        });
      }

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
        if (channel === "whatsapp") return Response.redirect(whatsappShareUrl(cfg, post, goUrl(cfg, code)), 302);
        return new Response(xSharePage(xShareText(cfg, post, goUrl(cfg, code))), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
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

    async scheduled(event: { cron?: string }, env: Env, ctx: Ctx): Promise<void> {
      const { cfg, db } = getDeps(env);
      if (event.cron === QUEUE_CRON) {
        ctx.waitUntil(publishDue(cfg, db).catch((e: unknown) => console.error("queue publish failed", e)));
        return;
      }
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
