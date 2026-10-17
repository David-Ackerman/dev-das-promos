// Points your Telegram bot at the Worker. Run automatically on deploy.
import { tg } from "../telegram.ts";

const token = process.env.TELEGRAM_BOT_TOKEN;
const base = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "");
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!token || !base || !secret) {
  throw new Error("TELEGRAM_BOT_TOKEN, PUBLIC_BASE_URL and TELEGRAM_WEBHOOK_SECRET are required");
}
if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
  throw new Error("TELEGRAM_WEBHOOK_SECRET must be 16+ chars of letters, numbers, _ or -");
}

await tg(token, "setWebhook", {
  url: `${base}/telegram/webhook`,
  secret_token: secret,
  // chat_member: joins/leaves in the groups (the bot must be an admin there), for /stats per invite link.
  allowed_updates: ["message", "callback_query", "chat_member"],
  drop_pending_updates: false,
});
await tg(token, "setMyCommands", {
  commands: [
    { command: "pendentes", description: "Prévias esperando aprovação" },
    { command: "stats", description: "Cliques e o que mais funciona" },
    { command: "fila", description: "Posts aprovados esperando o horário" },
    { command: "resumo", description: "Top 10 da semana para os grupos" },
    { command: "link", description: "Criar link de convite com nome (ex.: /link ig-bio)" },
    { command: "buscar", description: "Buscar promoções agora" },
    { command: "id", description: "Mostrar o id deste chat" },
    { command: "ajuda", description: "Ajuda" },
  ],
});
const info = await tg<{ url: string; pending_update_count: number; last_error_message?: string }>(
  token,
  "getWebhookInfo",
  {},
);
console.log(`Webhook set: ${info.url} (pending: ${info.pending_update_count})`);
if (info.last_error_message) console.log(`Last Telegram error: ${info.last_error_message}`);
