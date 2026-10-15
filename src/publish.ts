import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { pendingKeyboard, queuedKeyboard, renderInput, retryKeyboard, statusHeader, updatePreview } from "./preview.ts";
import { postTweet } from "./publishers/x.ts";
import { sendWhatsApp } from "./publishers/whatsapp.ts";
import { renderTelegram, renderWhatsApp, renderX } from "./render.ts";
import {
  deliveredTargets,
  dueQueued,
  getOrCreateLink,
  getPost,
  queueTail,
  recordPublication,
  setSchedule,
  transition,
} from "./repo.ts";
import { formatSlot, nextSlot } from "./schedule.ts";
import { type Keyboard, sendPost } from "./telegram.ts";
import type { PostRow } from "./types.ts";
import { errorMessage, escapeHtml } from "./util.ts";

export function goUrl(cfg: Config, code: string): string {
  return `${cfg.publicBaseUrl}/go/${code}`;
}

export interface PublishResult {
  ok: string[];
  failed: string[];
  manual: Keyboard;
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
  const result: PublishResult = { ok: [], failed: [], manual: [] };

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
  if (cfg.x.mode === "share") {
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
    return finishPublishing(cfg, db, postId);
  }
  if (!(await transition(db, postId, "pending", "queued"))) return "Esse post já foi processado.";
  const now = new Date();
  const at = nextSlot(now, await queueTail(db), cfg.queue);
  if (at.getTime() <= now.getTime() + 60_000 && (await transition(db, postId, "queued", "publishing"))) {
    return finishPublishing(cfg, db, postId);
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
  return finishPublishing(cfg, db, postId);
}

/** ↩️ on a queued post: back to a normal preview. */
export async function unschedulePost(cfg: Config, db: Db, postId: number): Promise<string> {
  if (!(await transition(db, postId, "queued", "pending"))) return "Esse post não está na fila.";
  await setSchedule(db, postId, null);
  const post = (await getPost(db, postId)) as PostRow;
  await updatePreview(cfg, post, undefined, pendingKeyboard(post));
  return "Voltou para as prévias.";
}

/** Worker cron: publishes the queued post whose time has come (one per tick keeps them spaced). */
export async function publishDue(cfg: Config, db: Db): Promise<number> {
  let published = 0;
  for (const id of await dueQueued(db, 1)) {
    if (await transition(db, id, "queued", "publishing")) {
      await finishPublishing(cfg, db, id);
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

/** The post is already in "publishing" (so nobody else is sending it): send and record the outcome. */
async function finishPublishing(cfg: Config, db: Db, postId: number): Promise<string> {
  const post = (await getPost(db, postId)) as PostRow;
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
  ].filter(Boolean);
  const emoji = status === "published" ? "✅" : status === "partial" ? "⚠️" : "❌";
  const header = `${statusHeader(post, emoji, status === "failed" ? "Falhou" : "Publicado")}${
    lines.length ? `\n<i>${escapeHtml(lines.join("\n"))}</i>` : ""
  }`;
  await updatePreview(cfg, post, header, result.failed.length ? [...result.manual, ...retryKeyboard(post)] : result.manual);
  return status === "failed" ? "Falhou ao publicar 😕" : "Publicado! 🚀";
}

export async function declinePost(cfg: Config, db: Db, postId: number): Promise<string> {
  if (!(await transition(db, postId, "pending", "declined"))) return "Esse post já foi processado.";
  const post = (await getPost(db, postId)) as PostRow;
  await updatePreview(cfg, post, statusHeader(post, "❌", "Recusado"), []);
  return "Recusado.";
}

