# Deploying to AWS, step by step

A self-contained runbook to take das-promos from zero to live on AWS
today, with real marketplace/publisher credentials and correctly-built
affiliate links -- not mocks. Follow it in order; Part 1 (credentials)
has the longest lead time (marketplace approval can take days), so start
it first even if you do Parts 2-3 in parallel.

If you want the broader picture (managed-services alternative, Oracle
Cloud, general checklist) see `docs/deployment.md` -- this doc is the
AWS-specific, credentials-included version of the same "cheapest path:
one VM" approach, using your existing AWS credit.

## What you'll end up with

- One AWS EC2 instance running Postgres + Redis + `apps/api` together
  (via `infra/docker/docker-compose.prod.yml`), including the
  self-scheduled ingest → score → publish routine.
- `apps/web` (public site) and `apps/admin` (dashboard) on Vercel's free
  tier.
- Real Telegram + X posting, with a real affiliate link on every post.

## Part 0: what actually works for real affiliate links today

Read this before choosing which marketplaces to launch with -- the
providers are not all equal on this specific point.

| Marketplace | Real product data | Real affiliate link | Verdict |
|---|---|---|---|
| **Shopee** | Yes (Affiliate Open API) | Yes -- `generateShortLink` mutation returns a real tracked Shopee short link server-side | **Ready.** Include in the automated loop. |
| **Amazon** | Yes (Creators API) | Yes -- standard `?tag=<partnerTag>` query param on the product URL, the same mechanism Amazon Associates has always used, independent of the Creators API details below | **Ready**, with one caveat: two response-shape details in the Creators API integration are inferred rather than confirmed against a live account (see Part 1.3) -- verify with one real ingestion before trusting it at volume. |
| **Mercado Livre** | Yes (official API) | **No.** `buildAffiliateUrl()` deliberately throws -- Mercado Livre has no public, documented API for generating affiliate links; their relaunched affiliate program only issues short links through a manual web portal, one product at a time, by a logged-in human. | **Not ready for the automated loop.** Any auto-approved Mercado Livre deal will fail its publish job on retry (BullMQ will log it as a failed job every cycle). **Leave `mercado_livre` out of `SCHEDULE_MARKETPLACES` today.** |

Recommendation: launch `SCHEDULE_MARKETPLACES=shopee_br` today, add
`amazon_br` once you've verified one real ingestion looks right (Part
5), and leave `mercado_livre` out of the automated loop entirely until
either Mercado Livre ships a real affiliate API or you build a manual
lookup table (a `externalId -> portal-generated short link` mapping --
see `docs/roadmap.md`'s Mercado Livre note for the shape of that).

## Part 1: get real credentials

Every subsection below tells you exactly what to click/submit as a
human, what you get back, which `.env` var it becomes, and any
prerequisite or gotcha that isn't obvious from the provider's own docs.

### 1.1 Shopee Affiliate Open API

**Prerequisite**: an approved Shopee Affiliate account for your market.
If you don't have one yet, apply at your region's affiliate portal
(e.g. `affiliate.shopee.com.br` for Brazil) -- this is a manual review
that commonly takes something like 1-2 weeks, so start it now if you
haven't.

1. Log into your **Shopee Affiliate homepage** with the approved
   account.
2. Find the **"Open API"** section/menu item on that dashboard (naming
   and exact placement can vary by region/dashboard version -- look for
   "Open API", "API Access", or "Developer" in the account/settings
   area if it's not on the main nav).
3. Your **App ID** (numeric) and **App Secret** (a long string) are
   generated/shown there -- copy both. If the section shows an
   "activate"/"create app" step instead of credentials directly, follow
   that first.
4. Your **Affiliate ID** is the same one you'd use for a normal Shopee
   affiliate link (`SHOPEE_AFFILIATE_ID` if you've set that before).
5. Set in `.env`: `SHOPEE_APP_ID`, `SHOPEE_APP_SECRET`,
   `SHOPEE_AFFILIATE_ID`.

**Caveat** (already in `docs/providers.md`): the exact GraphQL
schema/signature format this integration uses was verified against a
third-party-hosted mirror of Shopee's docs, not an authenticated console
session directly. It's internally consistent and corroborated across
sources, but if a real call fails with a schema-shaped error (unexpected
field name, signature rejected), that's the first place to check against
your own Shopee Open API console/docs link (usually linked from the same
Open API dashboard section).

### 1.2 Mercado Livre (product data only, not affiliate links)

1. Create an application at
   https://developers.mercadolivre.com.br/devcenter -- log in with the
   account that has the affiliate/associate program, click **"Create
   application"** (or go straight to
   https://developers.mercadolivre.com.br/devcenter/new-list-app), fill
   in the form (name, description), and register a **redirect URI**.
   **Mercado Livre requires this to be HTTPS -- plain `http://`
   (including `http://localhost:...`) is rejected outright**, even
   though you only need it for a one-time code capture and it never has
   to be a real running server. Two ways to get a valid HTTPS URL today
   with zero infrastructure:
   - **ngrok** (or any similar tunnel tool): `ngrok http 8080` prints a
     free `https://xxxx.ngrok-free.app` URL immediately -- use
     `https://xxxx.ngrok-free.app/callback` as the redirect URI. Nothing
     needs to actually be listening on port 8080; you're only going to
     read the `code` param off the browser's address bar after the
     redirect (it'll look like it failed to load -- that's fine).
   - If you've already completed Part 7 (DNS + TLS) below, use a real
     path under your own domain instead, e.g.
     `https://api.yourdomain.com/oauth-callback` -- same idea, no route
     handler required, you're just reading the address bar.
   The form also asks for a **logo/icon image** -- this is just a
   display asset for the app listing, not a verified brand requirement;
   any square PNG/JPG (roughly 512x512) satisfies it, it doesn't need to
   be a real logo. Submit. This gives you an **App ID** (client id) and
   **Client Secret**, shown on the application's detail page.
2. Visit, once, in a browser, logged into that same account:
   ```
   https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=$APP_ID&redirect_uri=$REDIRECT_URI
   ```
   Click **"Authorize"**/**"Allow"** on the consent screen. You'll be
   redirected to your redirect URI (it'll look like it failed to load if
   it's not a real server -- that's fine, look at the browser's address
   bar).
3. Copy the `code` query param from that redirect URL, then exchange it
   for tokens (the code is single-use and expires quickly, so do this
   right away):
   ```bash
   curl -X POST https://api.mercadolibre.com/oauth/token \
     -H 'accept: application/json' \
     -H 'content-type: application/x-www-form-urlencoded' \
     -d 'grant_type=authorization_code' \
     -d "client_id=$APP_ID" \
     -d "client_secret=$CLIENT_SECRET" \
     -d "code=$AUTH_CODE" \
     -d "redirect_uri=$REDIRECT_URI"
   ```
   Keep the `refresh_token` from the JSON response.
4. Set in `.env`: `MERCADO_LIVRE_APP_ID`, `MERCADO_LIVRE_CLIENT_SECRET`,
   `MERCADO_LIVRE_REFRESH_TOKEN`. **Mercado Livre rotates refresh
   tokens on every use** -- the running app logs a warning with the new
   value each time; update the env var before the next restart or
   authentication will fail (full mechanics in `docs/providers.md`).

Remember: this gets you real product/price data for Mercado Livre, not
automated affiliate links (Part 0) -- there is no step that gets you
those, because Mercado Livre doesn't expose one. Useful for manual
research, not for `SCHEDULE_MARKETPLACES` today.

**Don't try to automate the affiliate portal's internal endpoints as a
workaround** (e.g. anything under
`mercadolivre.com.br/affiliate-program/api/...` you might find via
browser dev tools while manually generating a link) -- these require a
logged-in browser session, not app credentials, aren't part of Mercado
Livre's documented API, can change or disappear with zero notice, and
automating them risks the affiliate account being flagged for using an
endpoint not intended for programmatic access. Manual, one-link-at-a-time
through the portal is genuinely the only supported option today.

### 1.3 Amazon Creators API

**Prerequisite, read this first**: you need an **already-approved Amazon
Associates account**, and Amazon's eligibility rules for API access are
real and enforced, not a formality:
- **Initial access**: 3 qualifying sales within your Associates
  account's first 180 days.
- **Ongoing access to the Creators API specifically**: multiple
  independent sources report Amazon now requires **10 qualifying sales
  in the trailing 30 days** to keep API access active, checked on a
  rolling monthly basis -- drop below that and access is revoked. This
  is a materially higher bar than the old PA-API's 3-per-30-days rule.
  Verify your current standing on Associates Central before investing
  time here if your sales volume is low; a code-perfect integration
  cannot bypass this.

If you clear that bar:

1. Go to https://affiliate-program.amazon.com/creatorsapi and register
   under your Associates account -- this is a **separate registration**
   from PA-API; old PA-API access key/secret key do **not** carry over.
2. You get a **Credential ID** (client id) and **Credential Secret**.
3. Set in `.env`: `AMAZON_CREATORS_CLIENT_ID`,
   `AMAZON_CREATORS_CLIENT_SECRET`, and keep your existing
   `AMAZON_AFFILIATE_TAG` (unchanged -- it's what goes into the `?tag=`
   affiliate link param, independent of the Creators API credentials).
4. **Before enabling this in the scheduled loop**, do one manual test
   ingestion (Part 5) and eyeball the results -- two details in this
   integration are inferred from Amazon's docs rather than directly
   confirmed (the exact Brazil `marketplace` string and the `getItems`
   response envelope key; see `docs/providers.md`'s Amazon section). If
   `searchItems` works but `getProduct`/`getItems` errors, that
   inferred field name is the first thing to check.

### 1.4 Telegram

1. Open a chat with **@BotFather** on Telegram (search for it by that
   exact handle), send `/newbot`, then answer its two prompts: a display
   name, and a username ending in `bot`.
2. BotFather replies with your **bot token**
   (`TELEGRAM_BOT_TOKEN`, format `123456789:ABCdef...`) -- copy it.
3. Open (or create) the target **group or channel**, add the bot as a
   **member**, then promote it to **admin** with at least "Post
   Messages" permission (Channel/Group settings → Administrators → Add
   Admin → search for your bot's username).
4. Get the **chat id** (`TELEGRAM_CHAT_ID`): post any message in the
   group/channel, then visit
   `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser (with
   your real token in the URL) and read the numeric `chat.id` field from
   the JSON response -- it'll be negative for groups/channels, which is
   normal, keep the minus sign. If `getUpdates` returns an empty
   `result: []`, send another message in the chat first (Telegram only
   returns updates it hasn't delivered yet) and reload. Alternatively,
   forward any message from the channel to **@userinfobot** or
   **@RawDataBot**, which reply with the chat id directly.
5. Set in `.env`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

### 1.5 X (Twitter)

**Cost note, read this first**: X discontinued its free developer tier
for new signups in February 2026 -- API access is now pay-per-use
(reported pricing: roughly $0.015 per post, or ~$0.20 per post if it
contains a link -- and every post this app makes contains the `/go/:code`
affiliate link). At 4 posts/day that's on the order of **$20-25/month**,
not free. Verify current pricing yourself at
https://developer.x.com/en/portal/products before committing, since this
changes periodically; budget for it either way, and skip X entirely
(leave its env vars blank, `MockPublisher` takes over automatically) if
that cost isn't justified yet.

**Already posting to X from an n8n workflow?** If that workflow already
works, you likely already have a Consumer Key/Secret + Access
Token/Secret pair from the X Developer Portal with Read+Write access --
that's the exact same OAuth 1.0a user-context credential shape this
app's `XPublisher` uses (`packages/content-engine/src/publishers/x-publisher.ts`).
Reuse those four values directly in `.env` (step 4 below) instead of
creating a new App -- no code changes needed, and since they're already
posting successfully from n8n, whatever access tier they're on already
works, so there's nothing to re-verify about pricing/tier first.

1. Go to https://developer.x.com, sign up for developer access if you
   haven't (this now includes setting up billing for the pay-per-use
   plan), and create a **Project**, then an **App** inside that project.
2. Open the App's settings → **"User authentication settings"** → click
   **"Set up"** (or "Edit") → set **App permissions** to **"Read and
   Write"** (posting needs write access) → save. **Do this before
   generating tokens** -- tokens generated while permissions were
   Read-only keep that reduced scope even after you change the setting
   later, and you'd have to regenerate them.
3. Go to the App's **"Keys and tokens"** tab:
   - Under **"Consumer Keys"**, generate/reveal the **API Key** and
     **API Key Secret**.
   - Under **"Authentication Tokens"**, generate the **Access Token**
     and **Access Token Secret** (make sure you do this *after* step 2,
     so they're issued with Read+Write access).
4. Set in `.env`: `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`,
   `X_ACCESS_TOKEN_SECRET`.

### 1.6 OpenRouter (optional -- AI-generated post copy)

Skip this entirely if the deterministic template copy is fine; nothing
else depends on it, and it's the one integration here with a genuinely
free tier.

1. Sign up and get a key at https://openrouter.ai/keys.
2. Pick a **currently free** model (slug ends in `:free`) from
   https://openrouter.ai/models?max_price=0 -- this list changes over
   time (models are added/retired every few months), there's no safe
   hardcoded default anywhere in this codebase on purpose.
3. Set in `.env`: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`.

## Part 2: launch the AWS EC2 instance

1. **Launch an instance**: Amazon Linux 2023 or Ubuntu 22.04+, size
   `t3.small` (2GB RAM -- Postgres + Redis + the Node process together
   want more headroom than `t3.micro`'s 1GB).
2. **Security group**: allow inbound `22` (SSH, ideally locked to your
   IP) and `4000` (the API). You don't need to open `5432`/`6379`
   publicly -- Postgres/Redis only need to be reachable from the `api`
   container on the same Docker network, not from the internet.
3. **SSH in**, then install Docker + the Compose plugin:
   ```bash
   # Amazon Linux 2023
   sudo dnf install -y docker git
   sudo systemctl enable --now docker
   sudo usermod -aG docker $USER   # log out/in once for this to take effect
   DOCKER_CONFIG=${DOCKER_CONFIG:-$HOME/.docker}
   mkdir -p $DOCKER_CONFIG/cli-plugins
   curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
     -o $DOCKER_CONFIG/cli-plugins/docker-compose
   chmod +x $DOCKER_CONFIG/cli-plugins/docker-compose
   ```
   (Ubuntu: `sudo apt update && sudo apt install -y docker.io git docker-compose-plugin`, then the same `usermod`/`systemctl` steps.)

## Part 3: deploy the app

```bash
git clone <this repo's URL> && cd dev-das-promos
cp .env.example .env
nano .env   # fill in every value from Part 1, plus the generated secrets below
```

Generate real secrets for these -- **never use the `.env.example`
placeholders**:

```bash
openssl rand -hex 32   # run 3 times, use one output each for:
# AUTH_SECRET, INTERNAL_API_TOKEN, ADMIN_PASSWORD (or pick your own password)
```

Set `ADMIN_EMAIL` to your real email. Leave `DATABASE_URL`/`REDIS_URL`
as the `.env.example` defaults -- `docker-compose.prod.yml` overrides
them to the container network names automatically, you don't need to
edit those two.

Bring the stack up and run migrations:

```bash
docker compose -f infra/docker/docker-compose.prod.yml up -d --build

docker compose -f infra/docker/docker-compose.prod.yml exec api \
  sh -c "cd /app/packages/database && pnpm exec tsx src/migrate.ts"
```

Confirm it's alive:

```bash
curl http://localhost:4000/health
# {"status":"ok","timestamp":"..."}
```

### Create the admin login

Run the seed script once, against this fresh, empty database:

```bash
docker compose -f infra/docker/docker-compose.prod.yml exec api \
  sh -c "cd /app/packages/database && pnpm exec tsx src/seed/index.ts"
```

This creates your real admin login (`ADMIN_EMAIL`/`ADMIN_PASSWORD` from
`.env`) **and** baseline affiliate commission rates per marketplace
(`affiliate_programs` -- the deal-scoring formula needs these to compute
a commission score; without them every deal scores as if commission were
zero). It also inserts demo categories/products/deals for
testing -- harmless placeholder data, identifiable later by
`metadata.source: "mock"` if you want to clean it out of the public site
once real ingested products are flowing. **Do not run this script again
later** -- it truncates and re-seeds every domain table on each run (see
`docs/deployment.md`); after this one-time run, real ingestion is what
populates the database going forward.

## Part 3.5: automate future deploys with GitHub Actions

Everything above was a one-time manual setup. From here on, pushing to
`main` on GitHub can redeploy automatically -- `.github/workflows/deploy.yml`
(already in the repo) SSHes into the EC2 box on every push and reruns
the same `git pull` + `docker compose up -d --build` + migrate commands
from Part 3, so there's nothing new to learn, just less to type by hand.
It deliberately does **not** build an image in CI or push to a registry
(ECR, GHCR) -- keeping the "build on the VM itself" approach from Part 3
avoids paying for or configuring a container registry at all.

1. **Push this repo to GitHub**, if it isn't already there:

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   gh repo create dev-das-promos --private --source=. --remote=origin --push
   ```

   (`--private` is a reasonable default for a repo carrying real business
   logic and infra config, even though secrets themselves stay out of it
   via `.gitignore`. Swap to `--public` if you want it open.)

2. **On the EC2 instance**, clone via SSH instead of HTTPS so the CI job
   (which authenticates as the instance's own key, not your GitHub
   login) can `git pull` non-interactively. If Part 3's `git clone`
   already used HTTPS, just repoint the remote:

   ```bash
   cd ~/dev-das-promos
   git remote set-url origin git@github.com:<your-username>/dev-das-promos.git
   ```

3. **Generate a dedicated deploy key** (don't reuse your personal SSH
   key) and add it two places -- as a GitHub **repo deploy key** (read
   access is enough, since the workflow only pulls) and to the EC2
   instance's SSH access:

   ```bash
   ssh-keygen -t ed25519 -f ./ec2-deploy-key -N ""   # run locally, creates a keypair
   ```

   - Public key (`ec2-deploy-key.pub`) → GitHub repo → **Settings → Deploy
     keys → Add deploy key** (this lets the EC2 box pull from GitHub).
   - Public key → also appended to `~/.ssh/authorized_keys` **on the EC2
     instance itself**, if you want the CI job to SSH in using this same
     key rather than your instance's original launch keypair (either
     works -- using a dedicated key here just means you can revoke CI
     access later without touching your personal EC2 login key).
   - Private key (`ec2-deploy-key`, no passphrase) → GitHub repo →
     **Settings → Secrets and variables → Actions → New repository
     secret**, named `EC2_SSH_KEY`. Also add `EC2_HOST` (the instance's
     public IP or domain) and `EC2_USER` (`ubuntu` for Ubuntu AMIs,
     `ec2-user` for Amazon Linux).
   - Delete the local `ec2-deploy-key`/`ec2-deploy-key.pub` files once
     both are uploaded -- they don't need to live on your laptop after
     this.

4. **Push to `main`** and check the **Actions** tab on GitHub -- the
   `Deploy to AWS EC2` workflow should run and finish green. From now on,
   every push to `main` redeploys; use `workflow_dispatch` (the "Run
   workflow" button on the Actions tab) to trigger it manually without a
   new commit if you ever need to.

**Caveat**: this redeploys unconditionally on every push to `main` with
no test gate in front of it. Add a `pnpm test`/`pnpm typecheck` job
before the `deploy` job in the same workflow (or as a required PR check)
once you're pushing more than solo -- not required to ship today, but
worth adding before this repo has more than one contributor.

## Part 4: deploy `apps/web` and `apps/admin` to Vercel

Do this now, before verification, so the next part can use the real
admin dashboard instead of raw `curl` for the admin-only steps.

1. Import the repo into Vercel as two separate projects, root directory
   set to `apps/web` and `apps/admin` respectively.
2. On each, set env vars: `API_URL` and `NEXT_PUBLIC_API_URL` both
   pointing at `http://<ec2-public-ip>:4000` (or your real domain once
   DNS is set up, Part 7).
3. Deploy. `apps/admin` is where you'll actually monitor/approve deals
   day to day; `apps/web` is the public SEO-facing site.
4. Log into `apps/admin` with `ADMIN_EMAIL`/`ADMIN_PASSWORD` from `.env`.

## Part 5: verify each real integration with a manual ingestion (do this before enabling the schedule)

Trigger ingestion for one marketplace via the API using your
`INTERNAL_API_TOKEN`:

```bash
curl -X POST http://localhost:4000/internal/ingestion/run \
  -H "X-Internal-Token: $INTERNAL_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"marketplace": "shopee_br"}'
# {"queued": true, "marketplace": "shopee_br"}
```

This enqueues ingestion; scoring happens automatically a few seconds
later. Check what landed, either via `/deals` in the admin dashboard, or
directly:

```bash
docker compose -f infra/docker/docker-compose.prod.yml exec postgres \
  psql -U postgres -d das_promos -c \
  "select slug, deal_score, status from deal_candidates order by created_at desc limit 5;"
```

In the admin dashboard, approve a `pending` deal (or find one that's
already `auto_approved`), then click **Publish** to check the **actual
affiliate link**, not just that the job ran.

Verify in order:
1. The message actually arrives in your Telegram group/channel.
2. The link in that message resolves through `/go/:code` (this app's
   own redirect, tracked) and lands on the real Shopee product page --
   for Shopee specifically, the destination stored is already a real
   Shopee-issued short link from `generateShortLink`, so clicking
   through should land you on Shopee with the affiliate attribution
   already baked in by Shopee's own redirect, not a query param you
   have to eyeball.
3. For Amazon, click through and confirm the final URL carries
   `?tag=<your AMAZON_AFFILIATE_TAG>` -- this is the one to actually
   check carefully given Part 1.3's caveat about inferred fields
   upstream of it.
4. The X post appears on your account.
5. Back in the admin deal detail page, publication status per channel
   should read `published`, not `failed`.

If a channel shows `failed`, check the `errorMessage` on that
publication row (visible in the admin deal detail page) before assuming
credentials are wrong -- it'll usually say exactly what the marketplace
or Telegram/X API rejected.

## Part 6: turn on the automated routine

Edit `.env` on the EC2 instance:

```bash
SCHEDULE_ENABLED=true
SCHEDULE_TIMES=09:00,13:00,17:00,21:00   # UTC -- convert your real "good engagement" times
SCHEDULE_MARKETPLACES=shopee_br          # add amazon_br once Part 5 verified it; leave mercado_livre out (Part 0)
SCHEDULE_PUBLISH_DELAY_MINUTES=15
SCHEDULE_PUBLISH_LIMIT=5
```

Restart and confirm it registered:

```bash
docker compose -f infra/docker/docker-compose.prod.yml up -d
docker compose -f infra/docker/docker-compose.prod.yml logs api | grep scheduler
# [scheduler] registered 4 ingest+publish cycle(s)/day for [shopee_br] at UTC times [...]
```

From here it runs unattended: ingest each configured time, publish the
best-scoring ready deals `SCHEDULE_PUBLISH_DELAY_MINUTES` later, using
whatever was most recently ingested -- nothing stale gets republished
(`docs/architecture.md`, README's "Automated posting routine" section).

## Part 7: DNS + TLS (optional but recommended before sharing links publicly)

- Point a subdomain (e.g. `api.yourdomain.com`) at the EC2 instance's
  public IP, and put a reverse proxy (Caddy or nginx with Let's
  Encrypt) in front of port 4000 for TLS -- EC2 itself doesn't
  provision certificates for you the way Vercel does automatically for
  `apps/web`/`apps/admin`.
- Update `API_URL`/`NEXT_PUBLIC_API_URL` on Vercel to the real
  `https://api.yourdomain.com` once that's live.

## Troubleshooting

- **A marketplace ingestion job fails immediately**: check
  `docker compose ... logs api` for the actual thrown error message --
  every real provider throws a descriptive error rather than failing
  silently (wrong credentials, expired Mercado Livre refresh token,
  rate limiting, etc.).
- **Mercado Livre publish jobs keep failing**: expected if
  `mercado_livre` is in `SCHEDULE_MARKETPLACES` -- see Part 0, remove it.
- **Scheduler doesn't seem to fire**: confirm the times are in UTC, not
  your local timezone, and check
  `docker compose ... logs api | grep scheduler` shows the registration
  line after every restart (it's safe/idempotent to see it repeat).
- **AI content generation never seems to kick in**: check
  `AI_CONTENT_DAILY_LIMIT` hasn't been exhausted for the day, and that
  both `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` are set -- either one
  missing silently falls back to template content, by design.

## Pre-launch checklist

- [ ] Real credentials set for every marketplace/channel you're
      launching with (Part 1)
- [ ] `mercado_livre` excluded from `SCHEDULE_MARKETPLACES` (Part 0)
- [ ] One manual ingest → approve → publish cycle verified end-to-end,
      affiliate links clicked and confirmed correct (Part 5)
- [ ] Every secret in `.env` rotated from the `.env.example` placeholders
- [ ] `pnpm db:seed`-equivalent run exactly once against the empty prod
      database, never again
- [ ] `SCHEDULE_ENABLED=true` with real UTC times, registration
      confirmed in logs
- [ ] `apps/web`/`apps/admin` deployed on Vercel, pointed at the real
      API URL
- [ ] TLS in front of the API if/when sharing public links widely
