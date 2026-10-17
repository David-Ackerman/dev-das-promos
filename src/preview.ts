import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { renderTelegram, STORE } from "./render.ts";
import { setPreview } from "./repo.ts";
import { editPost, type Keyboard, sendPost } from "./telegram.ts";
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
      `${post.ai_model === "template" ? " · texto padrão" : ""}${priceHistoryNote(post)}`;
  const body = renderTelegram(renderInput(cfg, post, `${cfg.publicBaseUrl}/go/•••••••`));
  return `${top}\n➖➖➖➖➖➖\n${body}`;
}

export function pendingKeyboard(post: PostRow): Keyboard {
  return [
    [
      { text: "✅ Aprovar", callback_data: `a:${post.id}` },
      { text: "❌ Recusar", callback_data: `d:${post.id}` },
    ],
    [
      { text: "🔄 Outro texto", callback_data: `r:${post.id}` },
      { text: "✏️ Meu texto", callback_data: `e:${post.id}` },
    ],
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

/** Redraws a preview for its current state (pending, or queued with its slot) after the text changed. */
export async function refreshPreview(cfg: Config, post: PostRow): Promise<void> {
  if (post.status === "queued" && post.scheduled_at) {
    const header = statusHeader(post, "🕒", `Agendado para ${formatSlot(new Date(post.scheduled_at), new Date())}`);
    await updatePreview(cfg, post, header, queuedKeyboard(post));
    return;
  }
  await updatePreview(cfg, post, undefined, pendingKeyboard(post));
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

export async function sendPreview(cfg: Config, db: Db, post: PostRow): Promise<void> {
  const { messageId, hasPhoto } = await sendPost(
    cfg.telegram.botToken,
    cfg.telegram.adminChatId,
    previewHtml(cfg, post),
    post.image_url,
    pendingKeyboard(post),
  );
  await setPreview(db, post.id, cfg.telegram.adminChatId, messageId, hasPhoto);
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
