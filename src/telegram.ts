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

function visibleLength(html: string): number {
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

export async function sendText(token: string, chatId: string, html: string, keyboard?: Keyboard) {
  return tg<{ message_id: number }>(token, "sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
}
