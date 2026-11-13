// `node src/jobs/links.ts` (LINKS_TEXT, LINKS_CHAT_ID, LINKS_MESSAGE_ID) — run by
// .github/workflows/links.yml when the admin sends more than INLINE_LINKS product
// links in one message. Each link becomes a preview, exactly like a link sent alone.
import { MAX_LINKS, postFromLink } from "../bot.ts";
import { loadConfig } from "../config.ts";
import { createNodeDb } from "../db-node.ts";
import { parseSubmissions } from "../manual.ts";
import { sendText } from "../telegram.ts";
import { errorMessage, escapeHtml, truncate } from "../util.ts";

const text = process.env.LINKS_TEXT ?? "";
const chatId = process.env.LINKS_CHAT_ID ?? "";
const messageId = Number(process.env.LINKS_MESSAGE_ID);
const cfg = loadConfig(process.env);
// Only the admin chat: the Worker only starts this for it, and the job must not post anywhere else.
if (chatId !== cfg.telegram.adminChatId) throw new Error("LINKS_CHAT_ID is not the admin chat");

const db = createNodeDb(cfg.databaseUrl);
const subs = parseSubmissions(text, MAX_LINKS);
const failed: string[] = [];
try {
  for (const [i, sub] of subs.entries()) {
    try {
      await postFromLink(cfg, db, chatId, messageId, sub);
      console.log(`${i + 1}/${subs.length} ok: ${sub.link}`);
    } catch (error) {
      failed.push(`${i + 1}. ${truncate(sub.link, 60)}: ${errorMessage(error)}`);
      console.log(`${i + 1}/${subs.length} failed: ${sub.link}: ${errorMessage(error)}`);
    }
  }
  const ok = subs.length - failed.length;
  await sendText(
    cfg.telegram.botToken,
    chatId,
    [
      `📥 Lote de links: ${ok} de ${subs.length} viraram prévia${ok === 1 ? "" : "s"} (ou pediram preço/nome acima).`,
      ...failed.map((f) => `⚠️ ${escapeHtml(f)}`),
    ].join("\n"),
  );
} finally {
  await db.close();
}
