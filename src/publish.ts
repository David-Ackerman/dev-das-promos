import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { renderInput, statusHeader, updatePreview } from "./preview.ts";
import { postTweet } from "./publishers/x.ts";
import { sendWhatsApp } from "./publishers/whatsapp.ts";
import { renderTelegram, renderWhatsApp, renderX } from "./render.ts";
import { getOrCreateLink, getPost, recordPublication, transition } from "./repo.ts";
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

/** Sends an approved post everywhere. Each channel fails independently. */
export async function publishEverywhere(cfg: Config, db: Db, post: PostRow): Promise<PublishResult> {
  const result: PublishResult = { ok: [], failed: [], manual: [] };

  // Telegram groups: one tracked link per group, so we can compare groups.
  for (const chatId of cfg.telegram.groupChatIds) {
    const label = `Telegram ${chatId}`;
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
    await recordPublication(db, { postId: post.id, channel: "whatsapp", target: "", status: "manual" });
    result.manual.push([{ text: "📲 Enviar no WhatsApp", url: `${cfg.publicBaseUrl}/wa/${code}` }]);
  } else if (cfg.whatsapp.mode !== "off") {
    for (const groupId of cfg.whatsapp.groupIds) {
      const label = `WhatsApp ${groupId}`;
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
  if (cfg.x.mode !== "off" && cfg.x.credentials) {
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

/** Approve button. Safe to call twice: only the first tap publishes. */
export async function approvePost(cfg: Config, db: Db, postId: number): Promise<string> {
  if (!(await transition(db, postId, "pending", "publishing"))) {
    return "Esse post já foi processado.";
  }
  const post = (await getPost(db, postId)) as PostRow;
  await updatePreview(cfg, post, statusHeader(post, "⏳", "Publicando…"), []);

  let result: PublishResult;
  try {
    result = await publishEverywhere(cfg, db, post);
  } catch (error) {
    result = { ok: [], failed: [errorMessage(error)], manual: [] };
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
    result.manual.length ? "WhatsApp: toque no botão abaixo e escolha os grupos" : "",
    result.failed.length ? `Falhou: ${result.failed.join(" | ")}` : "",
  ].filter(Boolean);
  const emoji = status === "published" ? "✅" : status === "partial" ? "⚠️" : "❌";
  const header = `${statusHeader(post, emoji, status === "failed" ? "Falhou" : "Publicado")}${
    lines.length ? `\n<i>${escapeHtml(lines.join("\n"))}</i>` : ""
  }`;
  await updatePreview(cfg, post, header, result.manual);
  return status === "failed" ? "Falhou ao publicar 😕" : "Publicado! 🚀";
}

export async function declinePost(cfg: Config, db: Db, postId: number): Promise<string> {
  if (!(await transition(db, postId, "pending", "declined"))) return "Esse post já foi processado.";
  const post = (await getPost(db, postId)) as PostRow;
  await updatePreview(cfg, post, statusHeader(post, "❌", "Recusado"), []);
  return "Recusado.";
}

