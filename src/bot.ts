import { candidateFromPost, generateCaption } from "./ai.ts";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import {
  EDIT_HINT,
  ownTextPrompt,
  pendingKeyboard,
  postIdFromOwnTextPrompt,
  refreshPreview,
  sendPreview,
  updatePreview,
} from "./preview.ts";
import {
  affiliateLinkFor,
  buildCandidate,
  parseSubmissions,
  SUBMIT_HELP,
  type Submission,
  submissionFromAmazonReply,
} from "./manual.ts";
import { approvePost, declinePost, publishNow, retryPost, unschedulePost } from "./publish.ts";
import { declineRoundup, proposeRoundup, sendRoundup } from "./roundup.ts";
import { formatSlot } from "./schedule.ts";
import {
  createPost,
  dbNow,
  findPostByPreview,
  getPost,
  getStats,
  listPending,
  listQueued,
  recordJoin,
  recordLeave,
  lowestSeenPrice,
  transition,
  updateCaption,
  upsertProduct,
} from "./repo.ts";
import { sendText, tg } from "./telegram.ts";
import type { PostRow } from "./types.ts";
import { errorMessage, escapeHtml, randomCode, sha256Hex, truncate } from "./util.ts";

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
  reply_to_message?: { message_id: number; text?: string };
}
interface ChatMember {
  status: string; // creator | administrator | member | restricted | left | kicked
  is_member?: boolean;
  user: TgUser;
}
interface ChatMemberUpdated {
  chat: { id: number };
  old_chat_member: ChatMember;
  new_chat_member: ChatMember;
  /** Present when they joined through an invite link (name = what /link gave it). */
  invite_link?: { invite_link: string; name?: string };
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
  chat_member?: ChatMemberUpdated;
}

function inChat(m: ChatMember): boolean {
  return ["creator", "administrator", "member"].includes(m.status) || (m.status === "restricted" && m.is_member === true);
}

/** Joins and leaves in our groups, per invite link, for /stats. Users are kept only as a salted hash. */
async function handleChatMember(cfg: Config, db: Db, u: ChatMemberUpdated): Promise<void> {
  const chatId = String(u.chat.id);
  if (!cfg.telegram.groupChatIds.includes(chatId)) return;
  const was = inChat(u.old_chat_member);
  const is = inChat(u.new_chat_member);
  if (was === is) return; // promotions, restrictions…
  const userHash = (await sha256Hex(`${u.new_chat_member.user.id}|${cfg.telegram.webhookSecret}`)).slice(0, 16);
  if (is) await recordJoin(db, chatId, userHash, u.invite_link ? (u.invite_link.name?.trim() || "link sem nome") : "");
  else await recordLeave(db, chatId, userHash);
}

const HELP = `<b>Comandos</b>
/pendentes — prévias esperando aprovação
/fila — posts aprovados esperando o horário
/resumo — monta o Top 10 da semana para enviar nos grupos
/video id — gera um vídeo curto (Reels/TikTok) do post, com a legenda pronta
/link nome — cria um link de convite com nome em cada grupo (ex.: /link ig-bio), para ver no /stats quem entrou por onde
/stats [dias] — cliques e o que mais funciona (padrão 7 dias)
/buscar — busca promoções agora
/id — mostra o id deste chat (útil para configurar grupos)

Nas prévias: ✅ aprova (entra na fila e sai no próximo horário livre), ❌ descarta, 🔄 gera outro texto, ✏️ usa o seu texto.
Na fila: ⚡ publica agora, ↩️ volta para as prévias.\nDepois de aprovar, 🐦 abre o X com o post pronto (se X_MODE=share).
Se algum canal falhar, 🔁 tenta de novo só onde faltou.
Para escrever o texto você mesmo, toque ✏️ Meu texto (ou responda à prévia). Vale até o post sair da fila.

${SUBMIT_HELP}`;

function isAdmin(cfg: Config, userId: number | undefined): boolean {
  return userId !== undefined && cfg.telegram.adminUserIds.includes(String(userId));
}

/**
 * The Worker only has ~30s, often too little for busy free models. When every
 * model failed in time, GitHub Actions retries with minutes to spare
 * (heal.yml) and edits the preview; the admin is told it's on the way.
 */
async function aiBusyFallback(cfg: Config, error: string): Promise<void> {
  const gh = cfg.githubDispatch;
  const started = gh ? (await dispatchWorkflow(gh, "heal.yml").catch(() => undefined))?.ok : false;
  const text = started
    ? "⏳ Os modelos de IA estão ocupados agora. Deixei um texto provisório e já pedi de novo em segundo plano: a prévia se atualiza sozinha em 1–2 minutos."
    : `⚠️ A IA falhou, usei um texto padrão. Toque 🔄 mais tarde ou responda à prévia com o seu texto.\n<i>${escapeHtml(truncate(error, 300))}</i>`;
  await sendText(cfg.telegram.botToken, cfg.telegram.adminChatId, text);
}

export async function regenerateCaption(cfg: Config, db: Db, post: PostRow): Promise<void> {
  const caption = await generateCaption(cfg.ai, candidateFromPost(post), post.caption);
  await updateCaption(db, post.id, caption.caption, caption.short, caption.model, caption.hashtag);
  const fresh = (await getPost(db, post.id)) as PostRow;
  await updatePreview(cfg, fresh, undefined, pendingKeyboard(fresh));
  if (caption.error) await aiBusyFallback(cfg, caption.error);
}

export function formatStats(s: Awaited<ReturnType<typeof getStats>>, xBudgetUsd?: number): string {
  const lines = [
    `📊 <b>Últimos ${s.days} dias</b>`,
    `Posts: ${s.posts.published} publicados · ${s.posts.declined} recusados · ${s.posts.pending} pendentes`,
    ...(s.x.postsMonth
      ? [
          `🐦 X este mês: ${s.x.postsMonth} posts, ${s.x.repliesMonth} com link · US$ ${s.x.spentMonthUsd.toFixed(2)}` +
            (xBudgetUsd ? ` de US$ ${xBudgetUsd.toFixed(2)}` : ""),
        ]
      : []),
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
    ...(s.siteViews.length
      ? [
          `<b>Site</b>: ${s.siteViews.reduce((n, v) => n + v.views, 0)} visitas (` +
            s.siteViews.map((v) => `${v.source ? escapeHtml(v.source) : "direto"} ${v.views}`).join(" · ") +
            ")",
          "",
        ]
      : []),
    ...(s.joins.length
      ? [
          "<b>Entradas nos grupos</b>",
          ...s.joins.map(
            (j) =>
              `• ${j.link_name ? escapeHtml(j.link_name) : "link público / adicionados"}: ${j.joins} entraram, ${j.leaves} saíram` +
              (j.old7 ? `, ${Math.round((j.stayed7 / j.old7) * 100)}% ficaram 7 dias` : ""),
          ),
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
    ...(s.bestHours.length
      ? [`<b>Melhores horários</b>: ${s.bestHours.map((h) => `${h.hour}h (${h.clicks})`).join(" · ")}`, ""]
      : []),
    "<b>Top produtos</b>",
    ...(s.topPosts.length
      ? s.topPosts.map(
          (p, i) => `${i + 1}. ${escapeHtml(truncate(p.title, 50))} — ${p.clicks} cliques (${p.marketplace}, -${p.discount_pct}%)`,
        )
      : ["—"]),
  ];
  return lines.join("\n");
}

/** Starts a GitHub Actions workflow of this repo (needs GH_DISPATCH_TOKEN + GH_REPO). */
async function dispatchWorkflow(
  gh: NonNullable<Config["githubDispatch"]>,
  workflow: string,
  inputs?: Record<string, string>,
): Promise<Response> {
  return fetch(
    `https://api.github.com/repos/${gh.repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${gh.token}`,
        accept: "application/vnd.github+json",
        "user-agent": "das-promos-bot",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ref: gh.ref, ...(inputs ? { inputs } : {}) }),
    },
  );
}

/** 🎬 / /video: the video is built in GitHub Actions (ffmpeg) and arrives in the admin chat. */
async function requestVideo(cfg: Config, db: Db, postId: number): Promise<string> {
  const gh = cfg.githubDispatch;
  if (!gh) return "Configure GH_DISPATCH_TOKEN e GH_REPO para gerar vídeos.";
  const post = await getPost(db, postId);
  if (!post) return `Não achei o post #${postId}.`;
  const res = await dispatchWorkflow(gh, "video.yml", { post_id: String(postId) });
  return res.ok ? `🎬 Gerando o vídeo do #${postId}… chega aqui em 1–2 minutos.` : `GitHub respondeu HTTP ${res.status}`;
}

/** Starts the "Collect deals" GitHub workflow. Used by /buscar and by the Worker's cron. */
export async function triggerCollect(cfg: Config): Promise<{ ok: boolean; message: string }> {
  const gh = cfg.githubDispatch;
  if (!gh) return { ok: false, message: "Configure GH_DISPATCH_TOKEN e GH_REPO para buscar promoções pelo bot." };
  const res = await dispatchWorkflow(gh, gh.workflow);
  return res.ok
    ? { ok: true, message: "🔎 Buscando promoções… as prévias chegam em 1–2 minutos." }
    : { ok: false, message: `Não consegui iniciar a busca: GitHub respondeu HTTP ${res.status}` };
}

/** A link sent in the admin chat becomes a preview, like the ones the search sends. */
async function postFromLink(cfg: Config, db: Db, chatId: string, messageId: number, sub: Submission): Promise<void> {
  const token = cfg.telegram.botToken;
  await tg(token, "setMessageReaction", { chat_id: chatId, message_id: messageId, reaction: [{ type: "emoji", emoji: "👀" }] }).catch(() => {});
  const built = await buildCandidate(sub);
  if (!built.ok && built.askAmazon) {
    // One reply with "price [old] Name" finishes it; the link travels inside the question.
    await tg(token, "sendMessage", {
      chat_id: chatId,
      text: built.reason,
      link_preview_options: { is_disabled: true },
      reply_markup: { force_reply: true, input_field_placeholder: "349,90 499,90 Nome do produto" },
    });
    return;
  }
  if (!built.ok) {
    await sendText(token, chatId, built.reason);
    return;
  }
  const c = built.candidate;
  const text = built.caption;
  const link = affiliateLinkFor(c, sub.link, cfg.amazonPartnerTag);
  const startedAt = await dbNow(db);
  const productId = await upsertProduct(db, c);
  // Page read + AI must fit in the ~30s the Worker gets after answering Telegram.
  const caption = text
    ? { caption: truncate(text, 600), short: truncate(text, 150), model: "manual", hashtag: undefined, error: undefined }
    : await generateCaption(cfg.ai, c, undefined, { budgetMs: 15_000 });
  const post = await createPost(db, {
    productId,
    ref: randomCode(10),
    candidate: c,
    affiliateUrl: link.url, // the admin's link byte for byte, or the tagged Amazon link built from it
    priceFromAdmin: sub.priceCents !== undefined,
    lowestSeenCents: await lowestSeenPrice(db, productId, startedAt),
    caption: caption.caption,
    captionShort: caption.short,
    hashtag: caption.hashtag,
    aiModel: caption.model,
  });
  try {
    await sendPreview(cfg, db, post);
  } catch (error) {
    await transition(db, post.id, "pending", "failed");
    throw error;
  }
  if (link.generated) {
    await sendText(token, chatId, `🔗 Esse link não tinha a sua tag da Amazon: o post #${post.id} usa o seu link de afiliado\n<code>${escapeHtml(link.url)}</code>`);
  }
  if (caption.error) await aiBusyFallback(cfg, caption.error);
}

async function handleCallback(cfg: Config, db: Db, cq: NonNullable<TgUpdate["callback_query"]>) {
  const answer = (text: string) =>
    tg(cfg.telegram.botToken, "answerCallbackQuery", { callback_query_id: cq.id, text }).catch(() => {});
  if (!isAdmin(cfg, cq.from.id)) return answer("Só o admin pode fazer isso.");
  const [action, rawId] = (cq.data ?? "").split(":");
  const postId = Number(rawId);
  if (!Number.isInteger(postId)) return answer("?");

  if (action === "w") {
    await answer("Enviando o resumo…");
    await sendRoundup(cfg, db, postId);
    return;
  }
  if (action === "wd") return answer(await declineRoundup(cfg, db, postId));

  if (action === "v") return answer(await requestVideo(cfg, db, postId));

  if (action === "a") {
    const post = await getPost(db, postId);
    if (!post || post.status !== "pending") return answer("Esse post já foi processado.");
    await answer(cfg.queue.intervalMinutes > 0 ? "Aprovado ✅" : "Publicando…");
    await approvePost(cfg, db, postId);
  } else if (action === "n") {
    const post = await getPost(db, postId);
    if (!post || post.status !== "queued") return answer("Esse post não está na fila.");
    await answer("Publicando…");
    await publishNow(cfg, db, postId);
  } else if (action === "u") {
    await answer(await unschedulePost(cfg, db, postId));
  } else if (action === "t") {
    const post = await getPost(db, postId);
    if (!post || (post.status !== "failed" && post.status !== "partial")) return answer("Nada para reenviar.");
    await answer("Tentando de novo…");
    await retryPost(cfg, db, postId);
  } else if (action === "d") {
    await answer(await declinePost(cfg, db, postId));
  } else if (action === "e") {
    const post = await getPost(db, postId);
    if (!post || (post.status !== "pending" && post.status !== "queued")) return answer("Esse post já foi publicado.");
    await answer("Escreva o seu texto 👇");
    await tg(cfg.telegram.botToken, "sendMessage", {
      chat_id: cfg.telegram.adminChatId,
      text: ownTextPrompt(postId),
      reply_markup: { force_reply: true, input_field_placeholder: "Seu texto para o post" },
    });
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

  // Reply to "Amazon blocked the page": price + name for that link.
  const amazonReply = !command && text ? submissionFromAmazonReply(msg.reply_to_message?.text, text) : undefined;
  if (amazonReply) {
    await postFromLink(cfg, db, chatId, msg.message_id, amazonReply);
    return;
  }

  // Replying to a preview, or to the ✏️ prompt, replaces the post's text.
  const promptedId = postIdFromOwnTextPrompt(msg.reply_to_message?.text);
  const replyTo = msg.reply_to_message && text && !command
    ? promptedId
      ? await getPost(db, promptedId)
      : await findPostByPreview(db, chatId, msg.reply_to_message.message_id)
    : undefined;
  if (replyTo) {
    const post = replyTo;
    if (post.status !== "pending" && post.status !== "queued") {
      await sendText(token, chatId, "Esse post já foi publicado, não dá mais para trocar o texto.");
      return;
    }
    await updateCaption(db, post.id, truncate(text, 600), truncate(text, 150), "manual");
    const fresh = (await getPost(db, post.id)) as PostRow;
    await refreshPreview(cfg, fresh);
    await tg(token, "setMessageReaction", {
      chat_id: chatId,
      message_id: msg.message_id,
      reaction: [{ type: "emoji", emoji: "👍" }],
    }).catch(() => {});
    return;
  }

  // A product link sent to the bot in the admin chat becomes a preview.
  if (!command && chatId === cfg.telegram.adminChatId) {
    const subs = parseSubmissions(text || msg.caption?.trim() || "");
    // One by one: the Worker has ~30s and each link is a page read + AI caption.
    for (const sub of subs) await postFromLink(cfg, db, chatId, msg.message_id, sub);
    if (subs.length) return;
  }

  switch (command) {
    case "/start":
    case "/ajuda":
    case "/help":
      await sendText(token, chatId, HELP);
      return;
    case "/stats": {
      const days = Math.min(Math.max(Number.parseInt(text.split(/\s+/)[1] ?? "7", 10) || 7, 1), 365);
      await sendText(token, chatId, formatStats(await getStats(db, days), cfg.x.mode === "thread" ? cfg.x.monthlyBudgetUsd : undefined));
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
    case "/fila": {
      const queued = await listQueued(db);
      const now = new Date();
      await sendText(
        token,
        chatId,
        queued.length
          ? `🕒 <b>${queued.length} na fila</b>\n${queued
              .map((p) => `${p.scheduled_at ? formatSlot(new Date(p.scheduled_at), now) : "—"} · #${p.id} ${escapeHtml(truncate(p.title, 50))}`)
              .join("\n")}`
          : "Fila vazia.",
      );
      return;
    }
    case "/video": {
      const id = Number((text.split(/\s+/)[1] ?? "").replace("#", ""));
      await sendText(token, chatId, Number.isInteger(id) && id > 0 ? await requestVideo(cfg, db, id) : "Use assim: <code>/video 123</code> (o número do post).");
      return;
    }
    case "/link": {
      const name = text.split(/\s+/).slice(1).join("-").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
      if (!name) {
        await sendText(token, chatId, "Use assim: <code>/link ig-bio</code> (um nome para a origem: ig-bio, tiktok-bio, site, x-bio…)");
        return;
      }
      if (!cfg.telegram.groupChatIds.length) {
        await sendText(token, chatId, "Nenhum grupo configurado em TELEGRAM_GROUP_IDS.");
        return;
      }
      const lines: string[] = [];
      for (const group of cfg.telegram.groupChatIds) {
        const link = await tg<{ invite_link: string }>(token, "createChatInviteLink", { chat_id: group, name }).catch(
          (e: unknown) => ({ invite_link: `⚠️ ${errorMessage(e)} (o bot precisa ser admin com permissão de convidar)` }),
        );
        lines.push(`${group}: ${escapeHtml(link.invite_link)}`);
      }
      await sendText(token, chatId, `🔗 Link "<b>${escapeHtml(name)}</b>":\n${lines.join("\n")}\n\nQuem entrar por ele aparece em /stats como "${escapeHtml(name)}".`);
      return;
    }
    case "/resumo":
      await proposeRoundup(cfg, db);
      return;
    case "/buscar":
      await sendText(token, chatId, (await triggerCollect(cfg)).message);
      return;
  }
}

export async function handleUpdate(cfg: Config, db: Db, update: TgUpdate): Promise<void> {
  try {
    if (update.callback_query) await handleCallback(cfg, db, update.callback_query);
    else if (update.chat_member) await handleChatMember(cfg, db, update.chat_member);
    else if (update.message) await handleMessage(cfg, db, update.message);
  } catch (error) {
    console.error("bot update failed", errorMessage(error));
    await sendText(cfg.telegram.botToken, cfg.telegram.adminChatId, `⚠️ Erro: ${escapeHtml(errorMessage(error))}`).catch(() => {});
  }
}
