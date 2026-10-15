# dev-das-promos

Finds Amazon and Shopee deals a few times a day and turns them into posts with your affiliate links and a short, funny AI-written text. It sends each post to **you on Telegram for approval**. When you tap ✅, it publishes to your **Telegram groups**, **WhatsApp** and **X**, and every link goes through our own redirect so we can see **which products, stores and channels get clicks**.

```
GitHub Actions (started 5x/day by the Worker) Cloudflare Worker (always on, free)
 ├─ fetch Shopee / Amazon deals               ├─ /telegram/webhook  ✅ ❌ 🔄 buttons, /stats …
 ├─ pick the best (discount, sales, no repeats)│     └─ on ✅: Telegram groups, WhatsApp, X
 ├─ affiliate link + AI text                  ├─ /go/<code>  log click → 302 to affiliate link
 └─ preview → your Telegram bot               └─ /wa/<code>  open WhatsApp with the post ready
                     \                       /
                      Neon Postgres (free, 1 GB) ← daily backup to GitHub
```

The Worker's cron (in `wrangler.toml`) starts the **Collect deals** workflow at the scheduled times. GitHub's own scheduler isn't used because it ran hours late or skipped runs entirely.

Everything runs on free plans: **GitHub Actions**, **Cloudflare Workers** and **Neon Postgres**. There are no servers to look after. To deploy, you push to `main`.

## How it works day to day

1. At 9h, 12h, 15h, 18h and 21h (Brasília time), the bot sends you previews of the best new deals (`POSTS_PER_RUN`, default 2).
2. Each preview has these buttons:
   - **✅ Aprovar** publishes it everywhere.
   - **❌ Recusar** discards it. The product won't come back for 14 days.
   - **🔄 Outro texto** asks the AI for a new joke.
   - **Reply to the preview with your own text** and it replaces the AI text.
3. After you approve, the ✅ ❌ 🔄 buttons disappear, so a post can't be sent twice. The preview then shows **📲 Enviar no WhatsApp** and **🐦 Postar no X**. Each one opens the app with the post already written and its own tracked link, so you just send it (see the WhatsApp and X sections below for why).
4. If a channel fails (the bot was removed from a group, X is out of credits…), the preview says which one and shows **🔁 Tentar de novo**. It sends only where it's still missing, so nobody gets the post twice.
5. If you don't answer a preview within 12h, it expires, because prices change.

Each preview also tells you, from our own price history, whether the deal is real: **📉** lowest price we've seen in 30 days, **↔️** same price as before, or **⚠️** it was recently cheaper (with the price). Only you see that line.

Bot commands: `/stats 7` shows clicks per channel, per group, per store and the top products. `/pendentes` lists posts waiting for you. `/buscar` looks for deals right now. `/id` shows the id of the chat it's sent in, which you need when setting up groups.

## Setup (one time, about 30 minutes)

### 1. Database: Neon
1. Create a free account at [neon.tech](https://neon.tech) and make a project in the **São Paulo** region.
2. Click **Connect** and copy the connection string. That's `DATABASE_URL`.

Neon's free plan never deletes your data. If you go over a limit, it pauses instead of deleting anything. Migrations here only ever *add* tables and columns, and a test blocks any `DROP` or `TRUNCATE`. On top of that, every deploy and every night saves a `pg_dump` backup to GitHub.

### 2. Cloudflare Worker
1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com). Open **Workers & Pages** once so your `*.workers.dev` subdomain gets created.
2. Go to **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"**. That token is `CLOUDFLARE_API_TOKEN`.
3. Copy the **Account ID** from the Workers overview page. That's `CLOUDFLARE_ACCOUNT_ID`.

### 3. Telegram
1. You already have the bot. Its token from @BotFather is `TELEGRAM_BOT_TOKEN`.
2. Make up a random secret (`openssl rand -hex 24`, or any 32+ letters and numbers). That's `TELEGRAM_WEBHOOK_SECRET`.
3. Add the bot as an **admin** in each promo group.
4. The `TELEGRAM_ADMIN_CHAT_ID` and `TELEGRAM_GROUP_IDS` values come from the bot's `/id` command, which only works after the first deploy (step 5). For now you can put a placeholder like `0` in `TELEGRAM_ADMIN_CHAT_ID`, then update both and redeploy.

### 4. GitHub settings
In the repo, go to **Settings → Environments → production** (create it if it doesn't exist) and add:

| Secrets | Variables |
| --- | --- |
| `DATABASE_URL` | `PUBLIC_BASE_URL` (after the first deploy) |
| `GH_DISPATCH_TOKEN` (see below) | `GH_REPO` = `owner/repo` |
| `TELEGRAM_BOT_TOKEN` | `TELEGRAM_ADMIN_CHAT_ID`, `TELEGRAM_GROUP_IDS` |
| `TELEGRAM_WEBHOOK_SECRET` | `SHOPEE_APP_ID`, `SHOPEE_KEYWORDS` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | `AMAZON_CLIENT_ID`, `AMAZON_PARTNER_TAG`, `AMAZON_KEYWORDS` |
| `SHOPEE_APP_SECRET`, `AMAZON_CLIENT_SECRET` | `AI_MODEL`, `WHATSAPP_MODE`, `X_MODE`, `MIN_DISCOUNT_PCT`… |
| `AI_API_KEY` (and X/WhatsApp keys if used) | |

To focus on a niche, set `SHOPEE_KEYWORDS` (what to search for), `BLOCKED_WORDS` (titles to skip, e.g. `capinha,película`) and `NICHE` (who the group is for, so the AI writes for them).

`GH_DISPATCH_TOKEN` is what lets the Worker start the deal search on schedule and from `/buscar`. Create it at **GitHub → Settings → Developer settings → Fine-grained tokens**: only this repository, permission **Actions: Read and write**. Without it, no search runs on its own, and the bot warns you at each scheduled time.

Every setting is explained in [`.env.example`](.env.example). Any name you add here is picked up automatically, so you never need to edit a workflow.

### 5. Deploy
Push to `main`, or open **Actions → Deploy → Run workflow**. The deploy:
1. runs the tests,
2. backs up the database, then applies new migrations,
3. deploys the Worker and uploads its settings,
4. points your Telegram bot at the Worker.

The first run prints your Worker URL in a warning. Save it as the `PUBLIC_BASE_URL` variable. Then send `/id` to your bot privately and inside each group, fill in `TELEGRAM_ADMIN_CHAT_ID` and `TELEGRAM_GROUP_IDS`, and run **Deploy** once more.

Test it with **Actions → Collect deals → Run workflow**. The previews should show up in your Telegram chat.

## Posting from your own links (Amazon, Mercado Livre)
Until a store's API is available (Amazon only opens the Creators API after enough sales, and Mercado Livre has no public API), you can send the bot an affiliate link in your private chat:

```
https://amzn.to/abc123 129,90 199,90
Texto do post (optional; without it the AI writes one)
```

- The bot opens the link and reads the product name, photo and prices when the store allows it. For Mercado Livre, share the product from the app as an affiliate and send the `meli.la` link as is: it opens your affiliate showcase, and the bot reads the featured product from it. If a store blocks the read, the bot says so and you type the price after the link.
- The numbers after the link are the price and the old price, in any order. Prices you type win over what the page says.
- If it can't read the product name, it tells you. Send it again with the name on the line below the link.
- Your link is kept **exactly as you sent it**, so your affiliate tag is untouched. Clicks still go through the bot's `/go` tracking.
- From there it's the normal flow: preview, ✅ ❌ 🔄, publish.

Links sent inside groups are ignored. Only your private chat with the bot counts.

## WhatsApp
WhatsApp's official API **can't post into normal groups**: its groups API is capped at 8 participants. So there are three options:

- `WHATSAPP_MODE=share` (default) is free and safe. After you approve, you tap **📲 Enviar no WhatsApp**, pick the groups and send. That's 2 taps, and it's still tracked through its own `/go` link.
- `evolution` uses [Evolution API](https://github.com/EvolutionAPI/evolution-api), a self-hosted server with a WhatsApp number linked by QR code. It's fully automatic.
- `zapi` uses [Z-API](https://z-api.io), a paid hosted service. It's also fully automatic.

The last two are unofficial and WhatsApp can ban numbers that look like spam. If you use them, use a dedicated number and keep the volume reasonable.

## X / Twitter
X dropped its free API in 2026. It's now pay-per-use, and **posts with a link cost a lot more** than plain text posts.
- `X_MODE=share` (default) is free. After you approve, tap **🐦 Postar no X**: a page opens with the post (joke, product, price and tracked link) and buttons to **copy it** or **open it in the X app**. You post it yourself.
- `X_MODE=no-link` posts the joke, product and price plus "🔗 Link na bio". This is the cheap option.
- `X_MODE=link` puts the tracked link in the post. It's more expensive per post.
- `X_MODE=off` disables X.

Check current prices in the X developer console.

## What we track
- Every channel and every group gets its **own** `/go/<code>` link, so you can compare Telegram group A, group B, WhatsApp and X.
- Clicks from link-preview robots (Telegram, WhatsApp and X fetch the link to draw the preview) are flagged and **left out** of `/stats`.
- Shopee links carry the post's `ref` as a **sub-id**, so Shopee's own conversion report shows which post made each sale. Amazon links stay exactly as Amazon returns them, because changing them can break attribution, so for Amazon we only see clicks.
- `price_snapshots` keeps every price we've seen. The preview uses it to warn you about fake "discounts".

Want to dig deeper? Open the Neon SQL editor and query `clicks`, `links`, `posts` and `products`.

## Local development
Requires Node 22.18+ (it runs TypeScript directly; there's no build step).

```bash
npm install
cp .env.example .env          # fill it in (a Neon "dev" branch is perfect for DATABASE_URL)
npm run migrate
npm run collect:dry           # fetch deals + AI text and print the previews, sends nothing
npm run collect               # real run: sends previews to your bot
npm test                      # unit tests; end-to-end tests run too if TEST_DATABASE_URL is set
npm run typecheck
```

## Changing the schema
Add a new file such as `migrations/002_something.sql`. Never edit or delete an applied file, and only use `ADD`/`CREATE` (a test rejects `DROP`, `TRUNCATE` and `DELETE`). It's applied automatically on the next deploy.

## Restoring a backup
Download `backup.dump` from **Actions → Backup database → a run → Artifacts**, then run:
```bash
pg_restore --no-owner --no-acl -d "$DATABASE_URL" backup.dump
```
Neon also lets you restore to any point in the last 6 hours (free plan).

## Files
```
src/
  collect.ts        pick deals → affiliate link → AI text → preview      (GitHub Actions)
  bot.ts            buttons, replies and commands                         (Worker)
  publish.ts        approve → Telegram groups, WhatsApp, X                (Worker)
  http.ts           /go, /wa, /telegram/webhook routes; worker.ts wires Neon
  providers/        amazon.ts, shopee.ts
  publishers/       whatsapp.ts, x.ts
  manual.ts         links you send to the bot -> product -> preview       (Worker)
  ai.ts render.ts preview.ts share.ts repo.ts telegram.ts config.ts
  jobs/             CLI entry points used by npm scripts and workflows
migrations/         SQL, applied once each, never rolled back
.github/workflows/  deploy (push to main), collect (cron), backup (daily), ci (PRs)
```
