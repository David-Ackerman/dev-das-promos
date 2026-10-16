import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { pendingKeyboard, queuedKeyboard, renderInput, retryKeyboard, statusHeader, updatePreview } from "./preview.ts";
import { checkPrice } from "./pricecheck.ts";
import { postTweet, uploadProductImage } from "./publishers/x.ts";
import { sendWhatsApp } from "./publishers/whatsapp.ts";
import { renderTelegram, renderWhatsApp, renderX } from "./render.ts";
import {
  deliveredTargets,
  dueQueued,
  getOrCreateLink,
  getPost,
  lastPublishedAt,
  queueTail,
  recordPublication,
  recordXUsage,
  type XUsage,
  xUsage,
  markDealEnded,
  recentlyPublished,
  sentTelegramMessages,
  setSchedule,
  transition,
  updatePostPrice,
} from "./repo.ts";
import { formatSlot, nextSlot } from "./schedule.ts";
import { CAPTION_LIMIT, editAnyMessage, type Keyboard, sendPost, visibleLength } from "./telegram.ts";
import type { PostRow } from "./types.ts";
import { brl, discountPct, errorMessage, escapeHtml, hasAnyWord, truncate } from "./util.ts";

export function goUrl(cfg: Config, code: string): string {
  return `${cfg.publicBaseUrl}/go/${code}`;
}

export interface PublishResult {
  ok: string[];
  failed: string[];
  manual: Keyboard;
  /** Channels deliberately left out this time (e.g. X's daily limit), not failures. */
  skipped?: string[];
}

export interface XPlan {
  post: boolean;
  /** Also reply with the link (the expensive kind of post). */
  reply: boolean;
  reason?: string;
}

function daysInMonthBrasilia(now = new Date()): number {
  const local = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * X_MODE=thread rules, so X stays inside X_MONTHLY_BUDGET_USD:
 * - at most X_DAILY_POSTS posts a day;
 * - each store's first deal of the day gets a slot; extra slots go to Amazon /
 *   Mercado Livre, and to Shopee only for niche hardware (X_SHOPEE_EXTRA_WORDS);
 * - spending is capped per day (budget ÷ days in the month) and per month; the
 *   link reply ($0.20) is added only while it still fits today's share.
 */
export function planXPost(cfg: Config, post: PostRow, usage: XUsage, now = new Date()): XPlan {
  const x = cfg.x;
  if (usage.postsToday >= x.dailyPosts) return { post: false, reply: false, reason: `limite de ${x.dailyPosts} posts por dia` };
  const firstOfStore = !usage.byStoreToday[post.marketplace];
  if (!firstOfStore && post.marketplace === "shopee" && !hasAnyWord(post.title, x.shopeeExtraWords)) {
    return { post: false, reply: false, reason: "já teve Shopee hoje e este não é hardware do nicho" };
  }
  const daily = x.monthlyBudgetUsd / daysInMonthBrasilia(now);
  const fits = (cost: number) =>
    usage.spentMonthUsd + cost <= x.monthlyBudgetUsd + 1e-9 && usage.spentTodayUsd + cost <= daily + 1e-9;
  if (!fits(x.postCostUsd)) return { post: false, reply: false, reason: "orçamento do X para hoje/mês" };
  return { post: true, reply: fits(x.postCostUsd + x.linkPostCostUsd) };
}

/** X_MODE=thread: a post without link (cheaper and shown to more people), with the product photo, plus a reply with the link. */
async function publishXThread(cfg: Config, db: Db, post: PostRow, result: PublishResult): Promise<void> {
  const creds = cfg.x.credentials!;
  const plan = planXPost(cfg, post, await xUsage(db));
  if (!plan.post) {
    result.skipped!.push(`X (${plan.reason})`);
    return;
  }
  try {
    const link = goUrl(cfg, await getOrCreateLink(db, post.id, "x"));
    const tail = plan.reply ? "👇 Link da oferta no primeiro comentário" : cfg.x.noLinkText;
    const text = renderX(renderInput(cfg, post, link), tail);
    // A missing or broken photo never blocks the post.
    const mediaId = await uploadProductImage(creds, post.image_url).catch((e) => {
      console.warn(`X image for #${post.id}: ${errorMessage(e)}`);
      return undefined;
    });
    const id = await postTweet(creds, text, mediaId ? { mediaIds: [mediaId] } : {});
    await recordXUsage(db, post.id, "post", cfg.x.postCostUsd);
    await recordPublication(db, { postId: post.id, channel: "x", target: "", status: "sent", externalId: id });
    let label = mediaId ? "X (com foto)" : "X";
    if (plan.reply) {
      try {
        await postTweet(creds, `🛒 Link da oferta: ${link}`, { replyTo: id });
        await recordXUsage(db, post.id, "reply", cfg.x.linkPostCostUsd);
        label += " + link no comentário";
      } catch (error) {
        label += ` (comentário com link falhou: ${errorMessage(error)})`;
      }
    }
    result.ok.push(label);
  } catch (error) {
    await recordPublication(db, { postId: post.id, channel: "x", target: "", status: "failed", error: errorMessage(error) });
    result.failed.push(`X: ${errorMessage(error)}`);
  }
}

/** Builds the WhatsApp text for a post using its WhatsApp tracking link. */
export async function whatsappText(cfg: Config, db: Db, post: PostRow, target = ""): Promise<{ code: string; text: string }> {
  const code = await getOrCreateLink(db, post.id, "whatsapp", target);
  return { code, text: renderWhatsApp(renderInput(cfg, post, goUrl(cfg, code))) };
}

/**
 * Sends an approved post everywhere. Each channel fails independently.
 * Destinations in `done` ("channel:target") already got it and are skipped.
 */
export async function publishEverywhere(
  cfg: Config,
  db: Db,
  post: PostRow,
  done: Set<string> = new Set(),
): Promise<PublishResult> {
  const result: PublishResult = { ok: [], failed: [], manual: [], skipped: [] };

  // Telegram groups: one tracked link per group, so we can compare groups.
  for (const chatId of cfg.telegram.groupChatIds) {
    const label = `Telegram ${chatId}`;
    if (done.has(`telegram:${chatId}`)) {
      result.ok.push(label);
      continue;
    }
    try {
      const code = await getOrCreateLink(db, post.id, "telegram", chatId);
      const html = renderTelegram(renderInput(cfg, post, goUrl(cfg, code)));
      const { messageId } = await sendPost(cfg.telegram.botToken, chatId, html, post.image_url);
      await recordPublication(db, { postId: post.id, channel: "telegram", target: chatId, status: "sent", externalId: String(messageId) });
      result.ok.push(label);
    } catch (error) {
      await recordPublication(db, { postId: post.id, channel: "telegram", target: chatId, status: "failed", error: errorMessage(error) });
      result.failed.push(`${label}: ${errorMessage(error)}`);
    }
  }

  // WhatsApp
  if (cfg.whatsapp.mode === "share") {
    const { code } = await whatsappText(cfg, db, post);
    if (!done.has("whatsapp:")) {
      await recordPublication(db, { postId: post.id, channel: "whatsapp", target: "", status: "manual" });
    }
    result.manual.push([{ text: "📲 Enviar no WhatsApp", url: `${cfg.publicBaseUrl}/wa/${code}` }]);
  } else if (cfg.whatsapp.mode !== "off") {
    for (const groupId of cfg.whatsapp.groupIds) {
      const label = `WhatsApp ${groupId}`;
      if (done.has(`whatsapp:${groupId}`)) {
        result.ok.push(label);
        continue;
      }
      try {
        const { text } = await whatsappText(cfg, db, post, groupId);
        const id = await sendWhatsApp(cfg.whatsapp, groupId, text, post.image_url);
        await recordPublication(db, { postId: post.id, channel: "whatsapp", target: groupId, status: "sent", externalId: id });
        result.ok.push(label);
      } catch (error) {
        await recordPublication(db, { postId: post.id, channel: "whatsapp", target: groupId, status: "failed", error: errorMessage(error) });
        result.failed.push(`${label}: ${errorMessage(error)}`);
      }
    }
  }

  // X
  if (cfg.x.mode === "thread" && cfg.x.credentials) {
    if (done.has("x:")) result.ok.push("X");
    else await publishXThread(cfg, db, post, result);
  } else if (cfg.x.mode === "share") {
    // Posting by hand is free; the API charges per post. The button opens X with the post written.
    const code = await getOrCreateLink(db, post.id, "x");
    if (!done.has("x:")) {
      await recordPublication(db, { postId: post.id, channel: "x", target: "", status: "manual" });
    }
    result.manual.push([{ text: "🐦 Postar no X", url: `${cfg.publicBaseUrl}/x/${code}` }]);
  } else if (cfg.x.mode !== "off" && cfg.x.credentials && done.has("x:")) {
    result.ok.push("X");
  } else if (cfg.x.mode !== "off" && cfg.x.credentials) {
    try {
      const code = await getOrCreateLink(db, post.id, "x");
      const tail = cfg.x.mode === "link" ? goUrl(cfg, code) : cfg.x.noLinkText;
      const text = renderX(renderInput(cfg, post, goUrl(cfg, code)), tail);
      const id = await postTweet(cfg.x.credentials, text);
      await recordPublication(db, { postId: post.id, channel: "x", target: "", status: "sent", externalId: id });
      result.ok.push("X");
    } catch (error) {
      await recordPublication(db, { postId: post.id, channel: "x", target: "", status: "failed", error: errorMessage(error) });
      result.failed.push(`X: ${errorMessage(error)}`);
    }
  }
  return result;
}

/**
 * Approve button (and auto-approve). Safe to call twice: only the first call
 * wins the pending -> publishing / pending -> queued transition.
 * With the queue on, the post waits for its slot; if the slot is now, it goes out right away.
 */
export async function approvePost(cfg: Config, db: Db, postId: number, opts: { auto?: boolean } = {}): Promise<string> {
  if (cfg.queue.intervalMinutes <= 0) {
    if (!(await transition(db, postId, "pending", "publishing"))) return "Esse post já foi processado.";
    return finishPublishing(cfg, db, postId, { checkPrice: true });
  }
  if (!(await transition(db, postId, "pending", "queued"))) return "Esse post já foi processado.";
  const now = new Date();
  const at = nextSlot(now, await queueTail(db), cfg.queue);
  if (at.getTime() <= now.getTime() + 60_000 && (await transition(db, postId, "queued", "publishing"))) {
    return finishPublishing(cfg, db, postId, { checkPrice: true });
  }
  await setSchedule(db, postId, at);
  const post = (await getPost(db, postId)) as PostRow;
  const who = opts.auto ? " · aprovado automaticamente 🤖" : "";
  await updatePreview(cfg, post, `${statusHeader(post, "🕒", `Agendado para ${formatSlot(at, now)}`)}${who}`, queuedKeyboard(post));
  return `Agendado para ${formatSlot(at, now)}`;
}

/** ⚡ on a queued post. */
export async function publishNow(cfg: Config, db: Db, postId: number): Promise<string> {
  if (!(await transition(db, postId, "queued", "publishing"))) return "Esse post não está na fila.";
  return finishPublishing(cfg, db, postId, { checkPrice: true });
}

/** ↩️ on a queued post: back to a normal preview. */
export async function unschedulePost(cfg: Config, db: Db, postId: number): Promise<string> {
  if (!(await transition(db, postId, "queued", "pending"))) return "Esse post não está na fila.";
  await setSchedule(db, postId, null);
  const post = (await getPost(db, postId)) as PostRow;
  await updatePreview(cfg, post, undefined, pendingKeyboard(post));
  return "Voltou para as prévias.";
}

/**
 * Worker cron: publishes the queued post whose time has come, one per tick.
 * Overdue posts (the cron was down, the admin approved many) keep the spacing
 * and wait for POSTING_HOURS instead of going out in a burst. ⚡ skips this.
 */
export async function publishDue(cfg: Config, db: Db): Promise<number> {
  const now = new Date();
  if (nextSlot(now, null, cfg.queue).getTime() > now.getTime()) return 0; // outside POSTING_HOURS
  const last = await lastPublishedAt(db);
  if (last && now.getTime() - last.getTime() < (cfg.queue.intervalMinutes - 1) * 60_000) return 0;
  let published = 0;
  for (const id of await dueQueued(db, 1)) {
    if (await transition(db, id, "queued", "publishing")) {
      await finishPublishing(cfg, db, id, { checkPrice: true });
      published++;
    }
  }
  return published;
}

/** Retry button on a failed/partial post: sends only to the destinations that didn't get it. */
export async function retryPost(cfg: Config, db: Db, postId: number): Promise<string> {
  if (
    !(await transition(db, postId, "failed", "publishing")) &&
    !(await transition(db, postId, "partial", "publishing"))
  ) {
    return "Nada para reenviar.";
  }
  return finishPublishing(cfg, db, postId);
}

/**
 * Right before a post goes out: is the price still what the preview showed?
 * Higher -> back to the admin; gone -> not published; lower -> published with
 * the better price. Returns the message for the admin when it stopped the post.
 */
async function holdIfPriceChanged(cfg: Config, db: Db, post: PostRow): Promise<string | undefined> {
  if (post.price_from_admin) return undefined; // typed by the admin (e.g. a coupon price): trust it
  const check = await checkPrice(cfg, post);
  if (check.verdict === "unknown" && check.detail) console.warn(`price check #${post.id}: ${check.detail}`);
  if (check.verdict === "gone") {
    await transition(db, post.id, "publishing", "expired");
    await updatePreview(cfg, post, `${statusHeader(post, "🚫", "Não publicado: o produto esgotou ou saiu do ar")}`, []);
    return "Esgotou: não publiquei.";
  }
  if ((check.verdict === "higher" || check.verdict === "lower") && check.priceCents) {
    const original = check.originalPriceCents ?? post.original_price_cents;
    await updatePostPrice(db, post, check.priceCents, original, discountPct(check.priceCents, original ?? undefined));
  }
  if (check.verdict === "higher" && check.priceCents) {
    await transition(db, post.id, "publishing", "pending");
    const fresh = (await getPost(db, post.id)) as PostRow;
    const header =
      `💸 <b>#${post.id} O preço subiu: ${brl(post.price_cents)} → ${brl(check.priceCents)}</b>\n` +
      "Não publiquei. Toque ✅ para publicar com o preço novo.";
    await updatePreview(cfg, fresh, header, pendingKeyboard(fresh));
    return "O preço subiu: não publiquei.";
  }
  return undefined;
}

/** The post is already in "publishing" (so nobody else is sending it): send and record the outcome. */
async function finishPublishing(cfg: Config, db: Db, postId: number, opts: { checkPrice?: boolean } = {}): Promise<string> {
  let post = (await getPost(db, postId)) as PostRow;
  if (opts.checkPrice) {
    const held = await holdIfPriceChanged(cfg, db, post);
    if (held) return held;
    post = (await getPost(db, postId)) as PostRow; // may carry a lower price now
  }
  // Buttons come off first so nobody can tap ✅ / 🔄 again; this edit failing must not stop the publish.
  await updatePreview(cfg, post, statusHeader(post, "⏳", "Publicando…"), []).catch((e) =>
    console.error("preview edit failed", errorMessage(e)),
  );

  let result: PublishResult;
  try {
    result = await publishEverywhere(cfg, db, post, await deliveredTargets(db, postId));
  } catch (error) {
    result = { ok: [], failed: [errorMessage(error)], manual: [] };
  }
  if (!result.ok.length && !result.manual.length && !result.failed.length) {
    result.failed.push("nenhum canal configurado (TELEGRAM_GROUP_IDS, WHATSAPP_MODE, X_MODE)");
  }

  const status =
    result.failed.length === 0
      ? "published"
      : result.ok.length > 0 || result.manual.length > 0
        ? "partial"
        : "failed";
  await transition(db, postId, "publishing", status);

  const lines = [
    result.ok.length ? `Enviado: ${result.ok.join(", ")}` : "",
    result.manual.length ? "Toque nos botões abaixo para postar no WhatsApp / X" : "",
    result.failed.length ? `Falhou: ${result.failed.join(" | ")}` : "",
    result.skipped?.length ? `Fora desta vez: ${result.skipped.join(", ")}` : "",
  ].filter(Boolean);
  const emoji = status === "published" ? "✅" : status === "partial" ? "⚠️" : "❌";
  const header = `${statusHeader(post, emoji, status === "failed" ? "Falhou" : "Publicado")}${
    lines.length ? `\n<i>${escapeHtml(lines.join("\n"))}</i>` : ""
  }`;
  await updatePreview(cfg, post, header, result.failed.length ? [...result.manual, ...retryKeyboard(post)] : result.manual);
  return status === "failed" ? "Falhou ao publicar 😕" : "Publicado! 🚀";
}

/** How long after publishing a deal is still watched, and how many are checked per run. */
const WATCH_DAYS = 3;
const WATCH_PER_RUN = 30;

/**
 * Search run: re-checks recently published deals. Sold out, or more than 5%
 * pricier than when posted -> the Telegram group messages get a banner on top,
 * so nobody clicks a dead deal. (WhatsApp / X messages can't be edited by us.)
 */
export async function flagEndedDeals(cfg: Config, db: Db, log: (msg: string) => void = console.log): Promise<number> {
  let ended = 0;
  for (const post of await recentlyPublished(db, WATCH_DAYS, WATCH_PER_RUN)) {
    const check = await checkPrice(cfg, post);
    let banner: string | undefined;
    if (check.verdict === "gone") banner = "❌ <b>ESGOTOU</b> · essa promoção acabou";
    else if (check.priceCents && check.priceCents > post.price_cents * 1.05) {
      banner = `⚠️ <b>O preço subiu</b>: agora ${brl(check.priceCents)}`;
    }
    if (!banner || !(await markDealEnded(db, post.id, banner))) continue;
    ended++;
    for (const msg of await sentTelegramMessages(db, post.id)) {
      const code = await getOrCreateLink(db, post.id, "telegram", msg.target);
      let html = `${banner}\n\n${renderTelegram(renderInput(cfg, post, goUrl(cfg, code)))}`;
      if (post.image_url && visibleLength(html) > CAPTION_LIMIT) {
        html = `${banner}\n\n🛍️ <b>${escapeHtml(truncate(post.title, 110))}</b>`;
      }
      await editAnyMessage(cfg.telegram.botToken, msg.target, Number(msg.message_id), html, Boolean(post.image_url)).catch((e) =>
        log(`Could not edit #${post.id} in ${msg.target}: ${errorMessage(e)}`),
      );
    }
    log(`Deal #${post.id} ended: ${banner.replace(/<[^>]+>/g, "")}`);
  }
  return ended;
}

export async function declinePost(cfg: Config, db: Db, postId: number): Promise<string> {
  if (!(await transition(db, postId, "pending", "declined"))) return "Esse post já foi processado.";
  const post = (await getPost(db, postId)) as PostRow;
  await updatePreview(cfg, post, statusHeader(post, "❌", "Recusado"), []);
  return "Recusado.";
}

