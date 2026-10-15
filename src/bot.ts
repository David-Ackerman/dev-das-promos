import { generateCaption } from "./ai.ts";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { EDIT_HINT, pendingKeyboard, sendPreview, updatePreview } from "./preview.ts";
import { buildCandidate, parseSubmission, SUBMIT_HELP, type Submission } from "./manual.ts";
import { approvePost, declinePost, retryPost } from "./publish.ts";
import {
  createPost,
  dbNow,
  findPostByPreview,
  getPost,
  getStats,
  listPending,
  lowestSeenPrice,
  transition,
  updateCaption,
  upsertProduct,
} from "./repo.ts";
import { sendText, tg } from "./telegram.ts";
import type { PostRow } from "./types.ts";
import { errorMessage, escapeHtml, randomCode, truncate } from "./util.ts";

interface TgUser {
  id: number;
}
interface TgMessage {
  message_id: number;
  chat: { id: number; type: string; title?: string };
  from?: TgUser;
  text?: string;
  /** Text under a photo/video; a shared product link can come this way. */
  caption?: string;
  reply_to_message?: { message_id: number };
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
}

const HELP = `<b>Comandos</b>
/pendentes — prévias esperando aprovação
/stats [dias] — cliques e o que mais funciona (padrão 7 dias)
/buscar — busca promoções agora
/id — mostra o id deste chat (útil para configurar grupos)

Nas prévias: ✅ publica, ❌ descarta, 🔄 gera outro texto.\nDepois de aprovar, 🐦 abre o X com o post pronto (se X_MODE=share).
Se algum canal falhar, 🔁 tenta de novo só onde faltou.
Para escrever o texto você mesmo, responda à prévia com o texto novo.

${SUBMIT_HELP}`;

function isAdmin(cfg: Config, userId: number | undefined): boolean {
  return userId !== undefined && cfg.telegram.adminUserIds.includes(String(userId));
}

export async function regenerateCaption(cfg: Config, db: Db, post: PostRow): Promise<void> {
  const caption = await generateCaption(cfg.ai, {
    marketplace: post.marketplace,
    externalId: "",
    title: post.title,
    productUrl: post.product_url,
    priceCents: post.price_cents,
    originalPriceCents: post.original_price_cents ?? undefined,
    discountPct: post.discount_pct,
  }, post.caption);
  await updateCaption(db, post.id, caption.caption, caption.short, caption.model);
  const fresh = (await getPost(db, post.id)) as PostRow;
  await updatePreview(cfg, fresh, undefined, pendingKeyboard(fresh));
  if (caption.error) {
    await sendText(
      cfg.telegram.botToken,
      cfg.telegram.adminChatId,
      `⚠️ A IA falhou, usei um texto padrão. Confira AI_MODEL / AI_API_KEY.\n<i>${escapeHtml(truncate(caption.error, 300))}</i>`,
    );
  }
}

export function formatStats(s: Awaited<ReturnType<typeof getStats>>): string {
  const lines = [
    `📊 <b>Últimos ${s.days} dias</b>`,
    `Posts: ${s.posts.published} publicados · ${s.posts.declined} recusados · ${s.posts.pending} pendentes`,
    "",
    "<b>Cliques por canal</b>",
    ...(s.byChannel.length
      ? s.byChannel.map((c) => `• ${c.channel}: ${c.clicks} (${c.unique} pessoas)`)
      : ["• nenhum clique ainda"]),
    "",
    ...(s.byTarget.length
      ? [
          "<b>Por grupo</b>",
          ...s.byTarget.map((t) => `• ${t.channel} ${escapeHtml(t.target)}: ${t.clicks} (${t.unique} pessoas)`),
          "",
        ]
      : []),
    "<b>Por loja</b>",
    ...(s.byMarketplace.length
      ? s.byMarketplace.map(
          (m) => `• ${m.marketplace}: ${m.clicks} cliques em ${m.posts} posts (${m.posts ? (m.clicks / m.posts).toFixed(1) : 0}/post)`,
        )
      : ["• nada publicado"]),
    "",
    "<b>Top produtos</b>",
    ...(s.topPosts.length
      ? s.topPosts.map(
          (p, i) => `${i + 1}. ${escapeHtml(truncate(p.title, 50))} — ${p.clicks} cliques (${p.marketplace}, -${p.discount_pct}%)`,
        )
      : ["—"]),
  ];
  return lines.join("\n");
}

/** Starts the "Collect deals" GitHub workflow. Used by /buscar and by the Worker's cron. */
export async function triggerCollect(cfg: Config): Promise<{ ok: boolean; message: string }> {
  const gh = cfg.githubDispatch;
  if (!gh) return { ok: false, message: "Configure GH_DISPATCH_TOKEN e GH_REPO para buscar promoções pelo bot." };
  const res = await fetch(
    `https://api.github.com/repos/${gh.repo}/actions/workflows/${gh.workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${gh.token}`,
        accept: "application/vnd.github+json",
        "user-agent": "das-promos-bot",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ref: gh.ref }),
    },
  );
  return res.ok
    ? { ok: true, message: "🔎 Buscando promoções… as prévias chegam em 1–2 minutos." }
    : { ok: false, message: `Não consegui iniciar a busca: GitHub respondeu HTTP ${res.status}` };
}

/** A link sent in the admin chat becomes a preview, like the ones the search sends. */
async function postFromLink(cfg: Config, db: Db, chatId: string, messageId: number, sub: Submission): Promise<void> {
  const token = cfg.telegram.botToken;
  await tg(token, "setMessageReaction", { chat_id: chatId, message_id: messageId, reaction: [{ type: "emoji", emoji: "👀" }] }).catch(() => {});
  const built = await buildCandidate(sub);
  if (!built.ok) {
    await sendText(token, chatId, built.reason);
    return;
  }
  const c = built.candidate;
  const text = built.caption;
  const startedAt = await dbNow(db);
  const productId = await upsertProduct(db, c);
  // Page read + AI must fit in the ~30s the Worker gets after answering Telegram.
  const caption = text
    ? { caption: truncate(text, 600), short: truncate(text, 150), model: "manual", error: undefined }
    : await generateCaption(cfg.ai, c, undefined, 15_000);
  const post = await createPost(db, {
    productId,
    ref: randomCode(10),
    candidate: c,
    affiliateUrl: sub.link, // already the affiliate link: never rewritten
    lowestSeenCents: await lowestSeenPrice(db, productId, startedAt),
    caption: caption.caption,
    captionShort: caption.short,
    aiModel: caption.model,
  });
  try {
    await sendPreview(cfg, db, post);
  } catch (error) {
    await transition(db, post.id, "pending", "failed");
    throw error;
  }
  if (caption.error) {
    await sendText(token, chatId, `⚠️ A IA falhou, usei um texto padrão.
<i>${escapeHtml(truncate(caption.error, 300))}</i>`);
  }
}

async function handleCallback(cfg: Config, db: Db, cq: NonNullable<TgUpdate["callback_query"]>) {
  const answer = (text: string) =>
    tg(cfg.telegram.botToken, "answerCallbackQuery", { callback_query_id: cq.id, text }).catch(() => {});
  if (!isAdmin(cfg, cq.from.id)) return answer("Só o admin pode fazer isso.");
  const [action, rawId] = (cq.data ?? "").split(":");
  const postId = Number(rawId);
  if (!Number.isInteger(postId)) return answer("?");

  if (action === "a") {
    const post = await getPost(db, postId);
    if (!post || post.status !== "pending") return answer("Esse post já foi processado.");
    await answer("Publicando…");
    await approvePost(cfg, db, postId);
  } else if (action === "t") {
    const post = await getPost(db, postId);
    if (!post || (post.status !== "failed" && post.status !== "partial")) return answer("Nada para reenviar.");
    await answer("Tentando de novo…");
    await retryPost(cfg, db, postId);
  } else if (action === "d") {
    await answer(await declinePost(cfg, db, postId));
  } else if (action === "r") {
    const post = await getPost(db, postId);
    if (!post || post.status !== "pending") return answer("Esse post já foi processado.");
    await answer("Gerando outro texto…");
    await regenerateCaption(cfg, db, post);
  } else {
    await answer("?");
  }
}

async function handleMessage(cfg: Config, db: Db, msg: TgMessage) {
  const token = cfg.telegram.botToken;
  const chatId = String(msg.chat.id);
  const text = msg.text?.trim() ?? "";
  const command = text.startsWith("/") ? (text.split(/\s+/)[0] ?? "").split("@")[0]?.toLowerCase() : undefined;

  // Anyone can ask for the chat id (to configure groups), everything else is admin-only.
  if (command === "/id") {
    await sendText(token, chatId, `Chat id: <code>${chatId}</code>${msg.from ? `\nSeu user id: <code>${msg.from.id}</code>` : ""}`);
    return;
  }
  if (!isAdmin(cfg, msg.from?.id)) return;

  // Replying to a preview replaces its text.
  const replyTo = msg.reply_to_message && text && !command
    ? await findPostByPreview(db, chatId, msg.reply_to_message.message_id)
    : undefined;
  if (replyTo) {
    const post = replyTo;
    if (post.status !== "pending") {
      await sendText(token, chatId, "Essa prévia já foi processada.");
      return;
    }
    await updateCaption(db, post.id, truncate(text, 600), truncate(text, 150), "manual");
    const fresh = (await getPost(db, post.id)) as PostRow;
    await updatePreview(cfg, fresh, undefined, pendingKeyboard(fresh));
    await tg(token, "setMessageReaction", {
      chat_id: chatId,
      message_id: msg.message_id,
      reaction: [{ type: "emoji", emoji: "👍" }],
    }).catch(() => {});
    return;
  }

  // A product link sent to the bot in the admin chat becomes a preview.
  if (!command && chatId === cfg.telegram.adminChatId) {
    const sub = parseSubmission(text || msg.caption?.trim() || "");
    if (sub) {
      await postFromLink(cfg, db, chatId, msg.message_id, sub);
      return;
    }
  }

  switch (command) {
    case "/start":
    case "/ajuda":
    case "/help":
      await sendText(token, chatId, HELP);
      return;
    case "/stats": {
      const days = Math.min(Math.max(Number.parseInt(text.split(/\s+/)[1] ?? "7", 10) || 7, 1), 365);
      await sendText(token, chatId, formatStats(await getStats(db, days)));
      return;
    }
    case "/pendentes": {
      const pending = await listPending(db);
      await sendText(
        token,
        chatId,
        pending.length
          ? `⏳ <b>${pending.length} pendente(s)</b>\n${pending.map((p) => `#${p.id} ${escapeHtml(truncate(p.title, 60))}`).join("\n")}\n\n${EDIT_HINT}`
          : "Nada pendente 🎉",
      );
      return;
    }
    case "/buscar":
      await sendText(token, chatId, (await triggerCollect(cfg)).message);
      return;
  }
}

export async function handleUpdate(cfg: Config, db: Db, update: TgUpdate): Promise<void> {
  try {
    if (update.callback_query) await handleCallback(cfg, db, update.callback_query);
    else if (update.message) await handleMessage(cfg, db, update.message);
  } catch (error) {
    console.error("bot update failed", errorMessage(error));
    await sendText(cfg.telegram.botToken, cfg.telegram.adminChatId, `⚠️ Erro: ${escapeHtml(errorMessage(error))}`).catch(() => {});
  }
}
