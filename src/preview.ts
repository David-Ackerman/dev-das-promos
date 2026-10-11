import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { renderTelegram } from "./render.ts";
import { setPreview } from "./repo.ts";
import { editPost, type Keyboard, sendPost } from "./telegram.ts";
import type { PostRow } from "./types.ts";
import { escapeHtml } from "./util.ts";

const STORE = { amazon: "Amazon", shopee: "Shopee" } as const;

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
  };
}

/** What the admin sees: a status header + the post exactly as the group will see it. */
export function previewHtml(cfg: Config, post: PostRow, header?: string): string {
  const top =
    header ??
    `📝 <b>Prévia #${post.id}</b> · ${STORE[post.marketplace]}${post.discount_pct ? ` · -${post.discount_pct}%` : ""}` +
      `${post.ai_model === "template" ? " · texto padrão" : ""}`;
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
      { text: "🔗 Ver produto", url: post.affiliate_url },
    ],
  ];
}

export const EDIT_HINT =
  "💡 Para trocar o texto, responda a esta prévia com o texto novo.";

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
