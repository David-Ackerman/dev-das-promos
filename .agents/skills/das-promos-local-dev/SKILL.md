---
name: das-promos-local-dev
description: "Run, test, deploy or troubleshoot das-promos (the Amazon/Shopee affiliate bot): .env setup, migrations, dry-run collect, the Telegram approval bot, the Cloudflare Worker, and the GitHub Actions deploy/collect/backup workflows. Use whenever the user wants to run or set up this project, a GitHub Action failed, previews aren't arriving in Telegram, buttons don't respond, or links/clicks look wrong."
---

# das-promos runbook

See `README.md` for the architecture and full setup, `AGENTS.md` for code rules.

## Local
1. Node 22.18+ (`node -v`). No Docker, no build step.
2. `npm install`, `cp .env.example .env`, fill at least DATABASE_URL (a Neon
   dev branch), PUBLIC_BASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID
   and one marketplace.
3. `npm run migrate` then `npm run collect:dry` (prints, sends nothing).
4. `npm test` (set TEST_DATABASE_URL to a throwaway Postgres to include the
   end-to-end flow test; never point it at production).

## Troubleshooting
- **No previews:** check Actions → "Collect deals" logs. "No marketplace
  configured" = missing SHOPEE_*/AMAZON_* settings. "Nenhuma promoção nova"
  in Telegram = nothing above MIN_DISCOUNT_PCT or all on cooldown.
- **Buttons do nothing:** run Actions → Deploy again (re-sets the webhook);
  the "Point the Telegram bot" step prints Telegram's last error. The tapping
  user's id must be in TELEGRAM_ADMIN_USER_IDS (or equal TELEGRAM_ADMIN_CHAT_ID).
- **Worker errors:** Cloudflare dashboard → Workers → das-promos → Logs.
- **Changed a setting:** collect picks it up on the next run; the Worker needs
  a Deploy run to receive new values.
- **Schema change:** add `migrations/00N_name.sql` (additive only), push.
