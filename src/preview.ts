import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { renderTelegram, STORE } from "./render.ts";
import type { ImageDecision } from "./images.ts";
import { setPostImage, setPreview } from "./repo.ts";
import { editPhoto, editPost, type Keyboard, sendPhotoFile, sendPost, tg, type UploadedImage } from "./telegram.ts";
import type { PostRow } from "./types.ts";
import { formatSlot } from "./schedule.ts";
import { brl, escapeHtml } from "./util.ts";

export function renderInput(cfg: Config, post: PostRow, link: string) {
  return {
    caption: post.caption,
    captionShort: post.caption_short,
    title: post.title,
    marketplace: post.marketplace,
    priceCents: post.price_cents,
    originalPriceCents: post.original_price_cents,
    discountPct: post.discount_pct,
    link,
    footer: cfg.footer,
    hashtag: post.hashtag,
  };
}

/** Only the admin sees this: is the "discount" real, judging by the prices we recorded? */
function priceHistoryNote(post: PostRow): string {
  const lowest = post.lowest_seen_cents;
  if (lowest === null) return "";
  if (lowest < post.price_cents) return `\n⚠️ Já esteve por ${brl(lowest)} nos últimos 30 dias`;
  if (lowest === post.price_cents) return "\n↔️ Mesmo preço que já vimos nos últimos 30 dias";
  return "\n📉 Menor preço que vimos em 30 dias";
}

/** What the admin sees: a status header + the post exactly as the group will see it. */
export function previewHtml(cfg: Config, post: PostRow, header?: string): string {
  const top =
    header ??
    `📝 <b>Prévia #${post.id}</b> · ${STORE[post.marketplace]}${post.discount_pct ? ` · -${post.discount_pct}%` : ""}` +
      `${post.ai_model === "template" ? " · texto padrão" : ""}${priceHistoryNote(post)}` +
      `${post.image_note ? `\n${post.image_source === "generated" ? "" : "⚠️ "}${escapeHtml(post.image_note)}` : ""}`;
  const body = renderTelegram(renderInput(cfg, post, `${cfg.publicBaseUrl}/go/•••••••`));
  return `${top}\n➖➖➖➖➖➖\n${body}`;
}

/** 🖼️ buttons only when an image model is set and the post has a photo at all. */
function imageRow(post: PostRow, cfg?: Config): Keyboard {
  if (!cfg?.images.model || !(post.store_image_url ?? post.image_url)) return [];
  const row = [{ text: "🖼️ Nova imagem", callback_data: `g:${post.id}` }];
  if (post.image_source === "generated") row.push({ text: "↩️ Foto da loja", callback_data: `o:${post.id}` });
  return [row];
}

export function pendingKeyboard(post: PostRow, cfg?: Config): Keyboard {
  return [
    [
      { text: "✅ Aprovar", callback_data: `a:${post.id}` },
      { text: "❌ Recusar", callback_data: `d:${post.id}` },
    ],
    [
      { text: "🔄 Outro texto", callback_data: `r:${post.id}` },
      { text: "✏️ Meu texto", callback_data: `e:${post.id}` },
    ],
    ...imageRow(post, cfg),
    [{ text: "🔗 Ver produto", url: post.affiliate_url }],
  ];
}

export function queuedKeyboard(post: PostRow): Keyboard {
  return [
    [
      { text: "⚡ Publicar agora", callback_data: `n:${post.id}` },
      { text: "↩️ Desagendar", callback_data: `u:${post.id}` },
    ],
    [{ text: "✏️ Meu texto", callback_data: `e:${post.id}` }],
  ];
}

/** Buttons for a preview in its current state (pending or queued). */
export function previewKeyboard(cfg: Config, post: PostRow): Keyboard {
  return post.status === "queued" ? queuedKeyboard(post) : pendingKeyboard(post, cfg);
}

function previewHeader(post: PostRow): string | undefined {
  return post.status === "queued" && post.scheduled_at
    ? statusHeader(post, "🕒", `Agendado para ${formatSlot(new Date(post.scheduled_at), new Date())}`)
    : undefined;
}

/**
 * Puts a new photo on a preview (an AI scene upload, or the store photo URL).
 * A preview that went out as text can't get a photo by editing, so it's sent
 * again and the old one removed. Returns the photo's Telegram file_id.
 */
export async function swapPreviewPhoto(cfg: Config, db: Db, post: PostRow, photo: UploadedImage | string): Promise<string | undefined> {
  const token = cfg.telegram.botToken;
  const html = previewHtml(cfg, post, previewHeader(post));
  const keyboard = previewKeyboard(cfg, post);
  if (post.preview_chat_id && post.preview_message_id && post.preview_has_photo) {
    return editPhoto(token, post.preview_chat_id, Number(post.preview_message_id), photo, html, keyboard);
  }
  const chatId = post.preview_chat_id ?? cfg.telegram.adminChatId;
  let messageId: number;
  let fileId: string | undefined;
  if (typeof photo === "string") {
    const sent = await sendPost(token, chatId, html, photo, keyboard);
    messageId = sent.messageId;
  } else {
    const sent = await sendPhotoFile(token, chatId, photo, html, keyboard);
    messageId = sent.messageId;
    fileId = sent.fileId;
  }
  if (post.preview_message_id) {
    await tg(token, "deleteMessage", { chat_id: chatId, message_id: Number(post.preview_message_id) }).catch(() => {});
  }
  await setPreview(db, post.id, chatId, messageId, true);
  return fileId;
}

/** Redraws a preview for its current state (pending, or queued with its slot) after the text changed. */
export async function refreshPreview(cfg: Config, post: PostRow): Promise<void> {
  if (post.status === "queued" && post.scheduled_at) {
    const header = statusHeader(post, "🕒", `Agendado para ${formatSlot(new Date(post.scheduled_at), new Date())}`);
    await updatePreview(cfg, post, header, queuedKeyboard(post));
    return;
  }
  await updatePreview(cfg, post, undefined, pendingKeyboard(post, cfg));
}

/** Text of the bot's "write your text" prompt; the reply to it is matched by the "#id" in it. */
export function ownTextPrompt(postId: number): string {
  return `✏️ Escreva o texto do post #${postId} e envie como resposta a esta mensagem.\nDica: 1 ou 2 frases curtas; nome, foto e preço o bot coloca sozinho.`;
}

export function postIdFromOwnTextPrompt(text: string | undefined): number | undefined {
  const id = text?.match(/^✏️ Escreva o texto do post #(\d+)/)?.[1];
  return id ? Number(id) : undefined;
}

/** On published previews: a short video for Reels / TikTok, built in GitHub Actions. */
export function videoKeyboard(post: PostRow): Keyboard {
  return [[{ text: "🎬 Vídeo para Reels/TikTok", callback_data: `v:${post.id}` }]];
}

export function retryKeyboard(post: PostRow): Keyboard {
  return [[{ text: "🔁 Tentar de novo", callback_data: `t:${post.id}` }]];
}

export const EDIT_HINT =
  "💡 Para usar o seu próprio texto, toque ✏️ Meu texto na prévia (ou responda à prévia com o texto).";

/** The Worker's address for a post's own photo (served from Telegram, see /img in http.ts). */
export function postImageUrl(cfg: Config, postId: number): string {
  return `${cfg.publicBaseUrl}/img/${postId}.jpg`;
}

/**
 * Sends the preview. With an AI scene (`image`), the photo is uploaded with
 * it and kept in Telegram; the post then uses /img/<id> everywhere.
 */
export async function sendPreview(cfg: Config, db: Db, post: PostRow, image?: ImageDecision): Promise<PostRow> {
  if (image?.kind === "generated") {
    const withNote = { ...post, image_source: "generated", image_note: image.note };
    try {
      const { messageId, fileId } = await sendPhotoFile(
        cfg.telegram.botToken,
        cfg.telegram.adminChatId,
        image.image,
        previewHtml(cfg, withNote),
        pendingKeyboard(withNote, cfg),
      );
      await setPostImage(db, post.id, { url: postImageUrl(cfg, post.id), fileId, source: "generated", note: image.note });
      await setPreview(db, post.id, cfg.telegram.adminChatId, messageId, true);
      return { ...withNote, image_url: postImageUrl(cfg, post.id) };
    } catch (error) {
      console.warn(`AI image upload failed, using the store photo: ${(error as Error).message}`);
    }
  }
  const note = image?.kind === "store" ? image.note : undefined;
  if (note) await setPostImage(db, post.id, null, note);
  const shown = { ...post, image_note: note ?? null };
  const { messageId, hasPhoto } = await sendPost(
    cfg.telegram.botToken,
    cfg.telegram.adminChatId,
    previewHtml(cfg, shown),
    post.image_url,
    pendingKeyboard(shown, cfg),
  );
  await setPreview(db, post.id, cfg.telegram.adminChatId, messageId, hasPhoto);
  return shown;
}

export async function updatePreview(
  cfg: Config,
  post: PostRow,
  header: string | undefined,
  keyboard: Keyboard,
): Promise<void> {
  if (!post.preview_chat_id || !post.preview_message_id) return;
  await editPost(
    cfg.telegram.botToken,
    post.preview_chat_id,
    Number(post.preview_message_id),
    post.preview_has_photo,
    previewHtml(cfg, post, header),
    keyboard,
  );
}

export function statusHeader(post: PostRow, emoji: string, text: string): string {
  return `${emoji} <b>#${post.id} ${escapeHtml(text)}</b>`;
}
