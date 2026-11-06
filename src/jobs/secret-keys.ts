// GitHub Secrets the workflows pass to `gh-export-env.ts`, one by one.
// Workflows must name each secret: since the repo is public, GitHub holds any
// run that passes `toJSON(secrets)` as "possibly malicious" until approved.
// Add a new secret here AND in the "Load settings" step of every workflow
// (test/unit.test.ts checks they match). Variables need no list: they are
// passed whole with `toJSON(vars)`.
export const SECRET_KEYS = [
  "AI_API_KEY",
  "ALIEXPRESS_APP_SECRET",
  "AMAZON_CLIENT_ID",
  "AMAZON_CLIENT_SECRET",
  "CEREBRAS_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "DATABASE_URL",
  "EVOLUTION_API_KEY",
  "GEMINI_API_KEY",
  "GH_DISPATCH_TOKEN",
  "GROQ_API_KEY",
  "SHOPEE_APP_SECRET",
  "TELEGRAM_ADMIN_CHAT_ID",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_GROUP_IDS",
  "TELEGRAM_WEBHOOK_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_TOKEN_SECRET",
  "X_API_KEY",
  "X_API_SECRET",
  "ZAPI_CLIENT_TOKEN",
  "ZAPI_TOKEN",
];
