import { handleUpdate, type TgUpdate, triggerCollect } from "./bot.ts";
import type { Config, Env } from "./config.ts";
import type { Db } from "./db.ts";
import { goUrl, publishDue } from "./publish.ts";
import { dealDetail, findDeals, getPost, postImageFileId, priceHistory, recordClick, recordSiteView, resolveLink, similarDeals, siteCoupons, siteDeals, sitemapDeals } from "./repo.ts";
import { sendText, telegramFileUrl } from "./telegram.ts";
import { whatsappShareUrl, xSharePage, xShareText } from "./share.ts";
import { dealPage, dealPath, privacyPage, sitePage, siteSource, slugify } from "./site.ts";
import { isIndexNowKeyPath, llmsTxt, robotsTxt, rssXml, sitemapXml } from "./seo.ts";
import { handleApi, handleMcp, openApi } from "./mcp.ts";
import { proposeRoundup, roundupWhatsAppUrl } from "./roundup.ts";
import { isValidCode, sha256Hex, titleKeywords } from "./util.ts";

/**
 * Cloudflare Worker (free plan). Routes:
 *   GET  /, /ofertas        public page with the live deals
 *   GET  /oferta/:id-:slug  one deal: price history, Product structured data
 *   GET  /sitemap.xml, /feed.xml, /llms.txt, /robots.txt   for search engines and AI assistants
 *   POST /mcp               MCP server for AI agents (src/mcp.ts)
 *   GET  /api/ofertas[/:id], /openapi.json   JSON search for AI agents / GPT actions
 *   GET  /privacidade       privacy notice
 *   GET  /go/:code          tracked redirect to the affiliate link (logs the click)
 *   GET  /wa/:code          opens WhatsApp with the post text ready to send
 *   GET  /x/:code           page to copy the X post or open it in the X app
 *   GET  /wr/:id            opens WhatsApp with the weekly roundup ready to send
 *   GET  /img/:id.jpg       a post's own photo (AI scene), streamed from Telegram
 *   POST /telegram/webhook  your bot's buttons and commands
 *   GET  /health
 * Plus crons (wrangler.toml): QUEUE_CRON publishes queued posts when their time
 * comes; the others start the "Collect deals" workflow on time, because GitHub's
 * own schedule runs hours late or not at all.
 */
export const QUEUE_CRON = "*/5 * * * *";
/**
 * Sundays 21:00 UTC = 18:00 in Brasília: the weekly Top 10 goes to the admin.
 * Cloudflare numbers weekdays 1-7 (or SUN-SAT): "0" for Sunday is rejected, and a
 * rejected cron throws out every schedule of the deploy (test/unit.test.ts checks).
 */
export const ROUNDUP_CRON = "0 21 * * SUN";
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
      const isRead = request.method === "GET" || request.method === "HEAD";
      const text = (body: string, type: string, maxAge = 300) =>
        new Response(request.method === "HEAD" ? null : body, {
          headers: { "content-type": `${type}; charset=utf-8`, "cache-control": `public, max-age=${maxAge}`, "access-control-allow-origin": "*" },
        });

      if (path === "/robots.txt" && isRead) return text(robotsTxt(getDeps(env).cfg), "text/plain", 3600);
      if (path === "/sitemap.xml" && isRead) {
        const { db, cfg } = getDeps(env);
        return text(sitemapXml(cfg, await sitemapDeals(db, 180, 5000)), "application/xml", 900);
      }
      if ((path === "/feed.xml" || path === "/rss.xml") && isRead) {
        const { db, cfg } = getDeps(env);
        return text(rssXml(cfg, await findDeals(db, { days: 14, limit: 40, liveOnly: false, source: "" })), "application/rss+xml", 600);
      }
      if ((path === "/llms.txt" || path === "/llms-full.txt") && isRead) {
        const { db, cfg } = getDeps(env);
        return text(llmsTxt(cfg, await findDeals(db, { days: 7, limit: 40, liveOnly: true, source: "" })), "text/markdown", 600);
      }
      if (path === "/openapi.json" && isRead) return text(JSON.stringify(openApi(getDeps(env).cfg), null, 2), "application/json", 3600);
      if (path === "/mcp") {
        const { db, cfg } = getDeps(env);
        return handleMcp(cfg, db, request);
      }
      if (path.startsWith("/api/")) {
        if (request.method === "OPTIONS") return handleMcp(getDeps(env).cfg, getDeps(env).db, request);
        if (!isRead) return new Response("Method Not Allowed", { status: 405 });
        const { db, cfg } = getDeps(env);
        return handleApi(cfg, db, url, path);
      }
      if (path === "/privacidade" && isRead) return text(privacyPage(getDeps(env).cfg), "text/html", 3600);
      if (isRead && isIndexNowKeyPath(getDeps(env).cfg, path)) return text(getDeps(env).cfg.indexNowKey!, "text/plain", 86400);

      const deal = path.match(/^\/oferta\/(\d{1,9})(?:-([a-z0-9-]*))?$/);
      if (deal && isRead) {
        const { db, cfg } = getDeps(env);
        const source = siteSource(url.searchParams.get("src"), request.headers.get("referer"));
        const d = await dealDetail(db, Number(deal[1]), source);
        if (!d) return new Response("Oferta não encontrada", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
        // One URL per deal: old or partial slugs move to the current one (keeping ?src=).
        if ((deal[2] ?? "") !== slugify(d.title)) {
          return new Response(null, { status: 301, headers: { location: `${dealPath(d.id, d.title)}${url.search}` } });
        }
        const ua = request.headers.get("user-agent") ?? "";
        if (request.method === "GET" && ua && !BOT_UA.test(ua)) {
          ctx.waitUntil(recordSiteView(db, source).catch((e) => console.error("site view log failed", e)));
        }
        const [history, similar] = await Promise.all([
          priceHistory(db, d.product_id, 90),
          similarDeals(db, d, titleKeywords(d.title), 6, source),
        ]);
        return text(dealPage(cfg, d, history, similar), "text/html");
      }
      if ((path === "/" || path === "/ofertas") && (request.method === "GET" || request.method === "HEAD")) {
        const { db, cfg } = getDeps(env);
        const source = siteSource(url.searchParams.get("src"), request.headers.get("referer"));
        const ua = request.headers.get("user-agent") ?? "";
        if (request.method === "GET" && ua && !BOT_UA.test(ua)) {
          ctx.waitUntil(recordSiteView(db, source).catch((e) => console.error("site view log failed", e)));
        }
        const [deals, coupons] = await Promise.all([siteDeals(db, 7, 60, source), siteCoupons(db, 30, 12, source)]);
        return new Response(sitePage(cfg, deals, coupons), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
        });
      }

      const img = path.match(/^\/img\/(\d{1,9})(?:\.jpg)?$/);
      if (img && (request.method === "GET" || request.method === "HEAD")) {
        const { db, cfg } = getDeps(env);
        const fileId = await postImageFileId(db, Number(img[1]));
        if (!fileId) return new Response("Not found", { status: 404 });
        // The download URL carries the bot token: fetched here, never sent to the client.
        const file = await fetch(await telegramFileUrl(cfg.telegram.botToken, fileId));
        if (!file.ok || !file.body) return new Response("Not found", { status: 404 });
        return new Response(request.method === "HEAD" ? null : file.body, {
          // Telegram stores every photo as JPEG, but its file server may label it octet-stream.
          headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=604800, immutable" },
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

      const wr = path.match(/^\/wr\/(\d{1,9})$/);
      if (wr && request.method === "GET") {
        const { db, cfg } = getDeps(env);
        const url = await roundupWhatsAppUrl(cfg, db, Number(wr[1]));
        return url ? Response.redirect(url, 302) : new Response("Not found", { status: 404 });
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
      if (event.cron === ROUNDUP_CRON) {
        ctx.waitUntil(proposeRoundup(cfg, db).catch((e: unknown) => console.error("weekly roundup failed", e)));
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
