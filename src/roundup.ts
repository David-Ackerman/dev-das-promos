import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { goUrl } from "./publish.ts";
import { shareUrl } from "./publishers/whatsapp.ts";
import {
  createRoundup,
  getOrCreateLink,
  getPostsByIds,
  getRoundup,
  setRoundupPreview,
  topDealsForRoundup,
  transitionRoundup,
} from "./repo.ts";
import { editPost, type Keyboard, sendText } from "./telegram.ts";
import type { PostRow } from "./types.ts";
import { brl, errorMessage, escapeHtml, truncate } from "./util.ts";

/**
 * Weekly "Top 10": the deals people clicked most in the last 7 days that are
 * still live, as one easy-to-forward message. The admin approves it like a
 * post; each group gets its own tracked links.
 */
const MIN_DEALS = 3;

function priceText(post: PostRow): string {
  return post.discount_pct > 0 ? `${brl(post.price_cents)} (-${post.discount_pct}%)` : brl(post.price_cents);
}

export function roundupTelegram(cfg: Config, posts: PostRow[], linkFor: (post: PostRow) => string): string {
  const items = posts.map(
    (p, i) => `${i + 1}. <b>${escapeHtml(truncate(p.title, 80))}</b> — ${priceText(p)}\n👉 ${escapeHtml(linkFor(p))}`,
  );
  return [
    `🔥 <b>Top ${posts.length} da semana</b>`,
    "As promoções que mais bombaram nos últimos 7 dias 👇",
    "",
    items.join("\n\n"),
    "",
    "<i>Os preços podem ter mudado desde a postagem.</i>",
    cfg.footer ? `<i>${escapeHtml(cfg.footer)}</i>` : "",
  ]
    .join("\n")
    .trim();
}

export function roundupWhatsApp(cfg: Config, posts: PostRow[], linkFor: (post: PostRow) => string): string {
  const items = posts.map((p, i) => `${i + 1}. *${truncate(p.title, 80)}* — ${priceText(p)}\n👉 ${linkFor(p)}`);
  return [
    `🔥 *Top ${posts.length} da semana*`,
    "As promoções que mais bombaram nos últimos 7 dias 👇",
    "",
    items.join("\n\n"),
    "",
    "_Os preços podem ter mudado desde a postagem._",
    cfg.footer ? `_${cfg.footer}_` : "",
  ]
    .join("\n")
    .trim();
}

function previewKeyboard(id: number): Keyboard {
  return [
    [
      { text: "✅ Enviar nos grupos", callback_data: `w:${id}` },
      { text: "❌ Descartar", callback_data: `wd:${id}` },
    ],
  ];
}

/** Weekly cron and /resumo: builds the roundup and sends it to the admin for approval. */
export async function proposeRoundup(cfg: Config, db: Db): Promise<string> {
  const ids = await topDealsForRoundup(db, 7, 10);
  if (ids.length < MIN_DEALS) {
    const msg = `Poucas promoções ativas nesta semana para o resumo (${ids.length}; preciso de ${MIN_DEALS}).`;
    await sendText(cfg.telegram.botToken, cfg.telegram.adminChatId, msg);
    return msg;
  }
  const id = await createRoundup(db, ids);
  const posts = await getPostsByIds(db, ids);
  const html = `📝 <b>Resumo #${id}</b> · prévia\n➖➖➖➖➖➖\n${roundupTelegram(cfg, posts, () => `${cfg.publicBaseUrl}/go/•••••••`)}`;
  const msg = await sendText(cfg.telegram.botToken, cfg.telegram.adminChatId, html, previewKeyboard(id));
  await setRoundupPreview(db, id, cfg.telegram.adminChatId, msg.message_id);
  return `Resumo #${id} com ${posts.length} promoções enviado para aprovação.`;
}

/** ✅ on the roundup preview. Safe to tap twice: the pending -> sent gate lets one through. */
export async function sendRoundup(cfg: Config, db: Db, id: number): Promise<string> {
  if (!(await transitionRoundup(db, id, "pending", "sent"))) return "Esse resumo já foi processado.";
  const roundup = (await getRoundup(db, id))!;
  const posts = await getPostsByIds(db, roundup.post_ids);
  const ok: string[] = [];
  const failed: string[] = [];
  for (const chatId of cfg.telegram.groupChatIds) {
    try {
      const codes = new Map<number, string>();
      for (const p of posts) codes.set(p.id, await getOrCreateLink(db, p.id, "telegram", chatId));
      await sendText(cfg.telegram.botToken, chatId, roundupTelegram(cfg, posts, (p) => goUrl(cfg, codes.get(p.id)!)));
      ok.push(chatId);
    } catch (error) {
      failed.push(`${chatId}: ${errorMessage(error)}`);
    }
  }
  const keyboard: Keyboard =
    cfg.whatsapp.mode === "share" ? [[{ text: "📲 Enviar no WhatsApp", url: `${cfg.publicBaseUrl}/wr/${id}` }]] : [];
  const lines = [
    ok.length ? `Enviado: Telegram ${ok.join(", ")}` : "",
    failed.length ? `Falhou: ${failed.join(" | ")}` : "",
  ].filter(Boolean);
  if (roundup.preview_chat_id && roundup.preview_message_id) {
    const html = `✅ <b>Resumo #${id} enviado</b>${lines.length ? `\n<i>${escapeHtml(lines.join("\n"))}</i>` : ""}\n➖➖➖➖➖➖\n${roundupTelegram(cfg, posts, () => `${cfg.publicBaseUrl}/go/•••••••`)}`;
    await editPost(cfg.telegram.botToken, roundup.preview_chat_id, Number(roundup.preview_message_id), false, html, keyboard).catch(() => {});
  }
  return failed.length && !ok.length ? "Falhou ao enviar 😕" : "Resumo enviado! 🚀";
}

/** ❌ on the roundup preview. */
export async function declineRoundup(cfg: Config, db: Db, id: number): Promise<string> {
  if (!(await transitionRoundup(db, id, "pending", "declined"))) return "Esse resumo já foi processado.";
  const roundup = (await getRoundup(db, id))!;
  if (roundup.preview_chat_id && roundup.preview_message_id) {
    await editPost(cfg.telegram.botToken, roundup.preview_chat_id, Number(roundup.preview_message_id), false, `❌ <b>Resumo #${id} descartado</b>`, []).catch(() => {});
  }
  return "Descartado.";
}

/** GET /wr/:id: WhatsApp with the roundup written, WhatsApp-tracked links. */
export async function roundupWhatsAppUrl(cfg: Config, db: Db, id: number): Promise<string | undefined> {
  const roundup = await getRoundup(db, id);
  if (!roundup || roundup.status !== "sent") return undefined;
  const posts = await getPostsByIds(db, roundup.post_ids);
  const codes = new Map<number, string>();
  for (const p of posts) codes.set(p.id, await getOrCreateLink(db, p.id, "whatsapp"));
  return shareUrl(roundupWhatsApp(cfg, posts, (p) => goUrl(cfg, codes.get(p.id)!)));
}
