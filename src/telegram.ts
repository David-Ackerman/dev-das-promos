/** Minimal Telegram Bot API client (works in Node and Cloudflare Workers). */
export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}
export type Keyboard = InlineButton[][];

export class TelegramError extends Error {}

export async function tg<T = unknown>(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: T;
    description?: string;
  };
  if (!json.ok) throw new TelegramError(`Telegram ${method}: ${json.description ?? `HTTP ${res.status}`}`);
  return json.result as T;
}

/** Telegram photo captions are capped at 1024 chars; longer posts go as text with link preview. */
export const CAPTION_LIMIT = 1024;

export function visibleLength(html: string): number {
  return html.replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt);/g, "x").length;
}

export async function sendPost(
  token: string,
  chatId: string,
  html: string,
  imageUrl?: string | null,
  keyboard?: Keyboard,
): Promise<{ messageId: number; hasPhoto: boolean }> {
  const reply_markup = keyboard ? { inline_keyboard: keyboard } : undefined;
  if (imageUrl && visibleLength(html) <= CAPTION_LIMIT) {
    try {
      const msg = await tg<{ message_id: number }>(token, "sendPhoto", {
        chat_id: chatId,
        photo: imageUrl,
        caption: html,
        parse_mode: "HTML",
        reply_markup,
      });
      return { messageId: msg.message_id, hasPhoto: true };
    } catch (error) {
      // Telegram sometimes can't fetch a marketplace image; fall back to text.
      console.warn(`sendPhoto failed, sending text instead: ${(error as Error).message}`);
    }
  }
  const msg = await tg<{ message_id: number }>(token, "sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: false },
    reply_markup,
  });
  return { messageId: msg.message_id, hasPhoto: false };
}

/** Edits a message we sent earlier, whether it was a photo (caption) or a text message. */
export async function editPost(
  token: string,
  chatId: string,
  messageId: number,
  hasPhoto: boolean,
  html: string,
  keyboard?: Keyboard,
): Promise<void> {
  const reply_markup = { inline_keyboard: keyboard ?? [] };
  try {
    if (hasPhoto) {
      await tg(token, "editMessageCaption", {
        chat_id: chatId,
        message_id: messageId,
        caption: html,
        parse_mode: "HTML",
        reply_markup,
      });
    } else {
      await tg(token, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: html,
        parse_mode: "HTML",
        reply_markup,
      });
    }
  } catch (error) {
    if (String((error as Error).message).includes("message is not modified")) return;
    // Text edit refused (too long, bad HTML…): still put the right buttons on it, so a
    // published or declined preview never keeps ✅ / 🔄. Then report the original error.
    await tg(token, "editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup }).catch(() => {});
    throw error;
  }
}

/**
 * Edits a message without knowing if it went out as a photo (caption) or as
 * text: tries one, and the other when Telegram says it's the wrong kind.
 */
export async function editAnyMessage(token: string, chatId: string, messageId: number, html: string, photoFirst: boolean): Promise<void> {
  const kinds = photoFirst ? [true, false] : [false, true];
  for (const [i, hasPhoto] of kinds.entries()) {
    try {
      await editPost(token, chatId, messageId, hasPhoto, html);
      return;
    } catch (error) {
      const wrongKind = /there is no (caption|text) in the message/i.test((error as Error).message);
      if (!wrongKind || i === kinds.length - 1) throw error;
    }
  }
}

/** Uploads a video file (up to 50 MB) to a chat. */
export async function sendVideoFile(token: string, chatId: string, bytes: Uint8Array, filename: string, html: string): Promise<void> {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", html);
  form.append("parse_mode", "HTML");
  form.append("supports_streaming", "true");
  form.append("width", "1080");
  form.append("height", "1920");
  form.append("video", new Blob([bytes], { type: "video/mp4" }), filename);
  const res = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!json.ok) throw new TelegramError(`Telegram sendVideo: ${json.description ?? `HTTP ${res.status}`}`);
}

export async function sendText(token: string, chatId: string, html: string, keyboard?: Keyboard) {
  return tg<{ message_id: number }>(token, "sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
}

interface PhotoSize {
  file_id: string;
  width: number;
}
interface PhotoMessage {
  message_id: number;
  photo?: PhotoSize[];
}

async function multipart<T>(token: string, method: string, form: FormData): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!json.ok) throw new TelegramError(`Telegram ${method}: ${json.description ?? `HTTP ${res.status}`}`);
  return json.result as T;
}

/** file_id of the biggest size Telegram made of an uploaded photo. */
function largestFileId(msg: PhotoMessage | true): string {
  const sizes = msg === true ? [] : (msg.photo ?? []);
  const best = [...sizes].sort((a, b) => b.width - a.width)[0];
  if (!best) throw new TelegramError("Telegram returned no photo");
  return best.file_id;
}

export interface UploadedImage {
  bytes: Uint8Array;
  mime: string;
}

function imageBlob(image: UploadedImage): Blob {
  return new Blob([image.bytes as Uint8Array<ArrayBuffer>], { type: image.mime });
}

/** Uploads a photo we made (not a URL). Returns the message and the photo's file_id, reusable in any chat. */
export async function sendPhotoFile(
  token: string,
  chatId: string,
  image: UploadedImage,
  html: string,
  keyboard?: Keyboard,
): Promise<{ messageId: number; fileId: string }> {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", html);
  form.append("parse_mode", "HTML");
  if (keyboard) form.append("reply_markup", JSON.stringify({ inline_keyboard: keyboard }));
  form.append("photo", imageBlob(image), `foto.${image.mime.includes("png") ? "png" : "jpg"}`);
  const msg = await multipart<PhotoMessage>(token, "sendPhoto", form);
  return { messageId: msg.message_id, fileId: largestFileId(msg) };
}

/**
 * Swaps the photo of a message we sent (a preview), keeping the caption and
 * buttons. `photo` is an upload or a URL/file_id. Returns the new file_id.
 */
export async function editPhoto(
  token: string,
  chatId: string,
  messageId: number,
  photo: UploadedImage | string,
  html: string,
  keyboard?: Keyboard,
): Promise<string> {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("message_id", String(messageId));
  const media = { type: "photo", media: typeof photo === "string" ? photo : "attach://photo", caption: html, parse_mode: "HTML" };
  form.append("media", JSON.stringify(media));
  if (typeof photo !== "string") form.append("photo", imageBlob(photo), `foto.${photo.mime.includes("png") ? "png" : "jpg"}`);
  form.append("reply_markup", JSON.stringify({ inline_keyboard: keyboard ?? [] }));
  return largestFileId(await multipart<PhotoMessage | true>(token, "editMessageMedia", form));
}

/** Download link for a file Telegram stores (valid ~1 hour). Contains the bot token: never show it to anyone. */
export async function telegramFileUrl(token: string, fileId: string): Promise<string> {
  const file = await tg<{ file_path?: string }>(token, "getFile", { file_id: fileId });
  if (!file.file_path) throw new TelegramError("Telegram getFile: no file_path");
  return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
}
