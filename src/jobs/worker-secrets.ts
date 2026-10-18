// Writes the settings the Cloudflare Worker needs (only the non-empty ones)
// to a JSON file for `wrangler secret bulk`. Affiliate links are created by the
// scheduled job; the Worker only needs Shopee's keys to re-check prices before
// publishing (Amazon's stay out).
import { writeFileSync } from "node:fs";

const WORKER_KEYS = [
  "DATABASE_URL",
  "PUBLIC_BASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_ADMIN_CHAT_ID",
  "TELEGRAM_ADMIN_USER_IDS",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_GROUP_IDS",
  "WHATSAPP_MODE",
  "WHATSAPP_GROUP_IDS",
  "EVOLUTION_API_URL",
  "EVOLUTION_API_KEY",
  "EVOLUTION_INSTANCE",
  "ZAPI_INSTANCE_ID",
  "ZAPI_TOKEN",
  "ZAPI_CLIENT_TOKEN",
  "X_MODE",
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_TOKEN_SECRET",
  "X_NO_LINK_TEXT",
  "X_DAILY_POSTS",
  "X_MONTHLY_BUDGET_USD",
  "X_POST_COST_USD",
  "X_LINK_POST_COST_USD",
  "X_SHOPEE_EXTRA_WORDS",
  "AI_BASE_URL",
  "AI_API_KEY",
  "AI_MODEL",
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "CEREBRAS_API_KEY",
  "NICHE",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "POST_FOOTER",
  "AMAZON_PARTNER_TAG",
  "SITE_NAME",
  "SITE_TELEGRAM_URL",
  "SITE_WHATSAPP_URL",
  "SITE_X_URL",
  "QUEUE_INTERVAL_MINUTES",
  "POSTING_HOURS",
  "SHOPEE_APP_ID",
  "SHOPEE_APP_SECRET",
  "GH_DISPATCH_TOKEN",
  "GH_REPO",
  "GH_COLLECT_WORKFLOW",
  "GH_REF",
];

const out = process.argv[2] ?? "worker-secrets.json";
const secrets: Record<string, string> = {};
for (const key of WORKER_KEYS) {
  const value = process.env[key];
  if (value !== undefined && value !== "") secrets[key] = value;
}
for (const key of ["DATABASE_URL", "PUBLIC_BASE_URL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_ADMIN_CHAT_ID", "TELEGRAM_WEBHOOK_SECRET"]) {
  if (!secrets[key]) throw new Error(`${key} is required for the Worker`);
}
writeFileSync(out, JSON.stringify(secrets));
console.log(`Worker settings: ${Object.keys(secrets).join(", ")}`);
