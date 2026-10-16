// Run by .github/workflows/heal.yml, which the Worker starts when every AI model
// was busy within its ~30s window (🔄 button, links sent to the bot). Here there
// is time to wait for the models: previews still on the stock text get an AI one.
import { healTemplateCaptions } from "../collect.ts";
import { loadConfig } from "../config.ts";
import { createNodeDb } from "../db-node.ts";
import { pendingTemplatePosts } from "../repo.ts";
import { sendText } from "../telegram.ts";
import { escapeHtml, truncate } from "../util.ts";

const cfg = loadConfig(process.env);
const db = createNodeDb(cfg.databaseUrl);
try {
  const healed = await healTemplateCaptions(cfg, db, console.log);
  const left = await pendingTemplatePosts(db, 10);
  console.log(JSON.stringify({ healed, stillTemplate: left.map((p) => p.id) }));
  if (left.length) {
    await sendText(
      cfg.telegram.botToken,
      cfg.telegram.adminChatId,
      `⚠️ A IA continua ocupada para ${left.map((p) => `#${p.id}`).join(", ")}. ` +
        `A próxima busca tenta de novo; se preferir, toque 🔄 ou responda à prévia com o seu texto.\n` +
        `<i>${escapeHtml(truncate(left.map((p) => p.title).join(" · "), 200))}</i>`,
    );
  }
} finally {
  await db.close();
}
