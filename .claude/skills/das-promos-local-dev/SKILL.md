---
name: das-promos-local-dev
description: "Set up, start, restart, reset, or troubleshoot the das-promos local development environment: Docker Postgres/Redis, env vars, migrations, seed data, the three pnpm dev apps (api/admin/web), and the test suite. Use this whenever the user wants to run or set up this project, mentions \"pnpm dev\" acting up, ECONNREFUSED/EADDRINUSE errors, Docker not running, a missing/incomplete .env, admin login not working, or wants to reset/reseed the local database — even if they just say \"run the app\" or paste a raw error from their terminal without naming any of this explicitly."
---

# das-promos local dev environment

This is the project-specific runbook for das-promos (see `CLAUDE.md` at the
repo root for architecture). It exists because this stack has several
non-obvious moving parts — Docker infra, env-var loading per app, and a
migration/seed order — and getting any one of them wrong produces
confusing errors that look unrelated to the real cause. Work through this
top-down rather than guessing at the symptom.

## Fresh setup (nothing running yet)

```bash
docker compose -f infra/docker/docker-compose.yml up -d   # Postgres :5432, Redis :6379
pnpm install
cp .env.example .env          # placeholder values work for local dev — see "What .env values actually matter" below
pnpm db:migrate
pnpm db:seed                   # creates the admin login + demo categories/products/deals
pnpm dev                       # api :4000, admin :3001, web :3000
```

Then: admin at http://localhost:3001 (login with `ADMIN_EMAIL`/`ADMIN_PASSWORD`
from `.env`), public site at http://localhost:3000, API health check at
http://localhost:4000/health.

## Diagnosing a broken `pnpm dev`

Don't just restart blindly — figure out *which* layer is actually broken
first, since the fix and the wait time differ a lot:

```bash
docker compose -f infra/docker/docker-compose.yml ps    # are postgres/redis up and healthy?
lsof -i :4000 -sTCP:LISTEN    # is the api actually listening?
lsof -i :3000 -sTCP:LISTEN    # web
lsof -i :3001 -sTCP:LISTEN    # admin
curl -s http://localhost:4000/health
```

**"Module not found: Can't resolve './something.js'"** (in web/admin, or
from `drizzle-kit`) — not a missing file. This repo's `.ts` files import
each other with a `.js` extension (a deliberate NodeNext-ESM convention),
and Next.js's webpack bundler / drizzle-kit's `esbuild-register` can't
resolve that on their own. `apps/web/next.config.mjs` and
`apps/admin/next.config.mjs` already carry a `resolve.extensionAlias` fix
for the Next.js side, and `packages/database`'s `db:generate`/`db:studio`
scripts already run through `tsx` instead of the bare `drizzle-kit` CLI
for the same reason. If this error reappears, something regressed one of
those, rather than a new file actually being missing — check those
configs before touching the import itself.

**`Invalid environment configuration: DATABASE_URL: Required` /
`REDIS_URL: Required`** — the process didn't get the root `.env` loaded.
`apps/api`, `apps/web`, and `apps/admin` each wrap their `dev`/`build`/
`start`/`test` scripts with `dotenv -e ../../.env -- <command>`
(`dotenv-cli`) rather than reading a per-app `.env` file — there is no
`.env` inside any `apps/*` directory, and there shouldn't be one. If you
add a new script that touches env vars, wrap it the same way instead of
creating a per-app `.env`.

**`fetch failed` / `ECONNREFUSED` from web or admin hitting the api** — the
api process isn't actually up, even if its terminal output looks quiet
rather than crashed. Check `curl http://localhost:4000/health` directly.
The most common cause is Docker having stopped underneath a still-running
`pnpm dev`: `apps/api/src/env.ts` connects to Postgres/Redis at boot, and
if that fails, `tsx watch` catches the crash and just idles — it does
**not** retry on its own, it only restarts on a file save. If
`docker compose ... ps` shows Postgres/Redis down, bring them back up
(`docker compose -f infra/docker/docker-compose.yml up -d`, wait for
`health: healthy`) and then fully restart `pnpm dev` (Ctrl+C, rerun) —
don't wait for it to self-heal.

**`EADDRINUSE: address already in use`** — a previous `pnpm dev` (or a
stray test run) is still holding the port. Find and stop it rather than
picking a new port:

```bash
lsof -ti :4000 | xargs kill   # swap the port number as needed
```

**Docker daemon itself isn't running** (`Cannot connect to the Docker
daemon`) — on macOS, `open -a Docker` starts Docker Desktop; poll
`docker info` until it succeeds before running `docker compose up -d`.

## What `.env` values actually matter for local dev

`cp .env.example .env` with no edits is enough to run everything — Zod
validation (`packages/config/src/env.ts`) only enforces *shape* (URLs
well-formed, secrets ≥16 chars), not that values are "real":

- `DATABASE_URL`, `REDIS_URL`, `API_URL`, `ADMIN_URL`, `PUBLIC_WEB_URL` —
  already correct for the local Docker setup, no edits needed.
- `INTERNAL_API_TOKEN`, `AUTH_SECRET` — just shared secrets for local
  service-to-service calls / session signing; the placeholders satisfy
  the length check and work fine for local dev.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` — become your real admin login the
  moment `pnpm db:seed` runs (`packages/database/src/seed/admin.ts`).
  Change these *before* seeding if you want a different login; seeding
  is idempotent (skips creation if that email already exists), so
  changing `.env` after the fact won't update an already-seeded admin —
  either pick a new email or update the row directly.
- `AMAZON_AFFILIATE_TAG`, `SHOPEE_AFFILIATE_ID`, `MERCADO_LIVRE_AFFILIATE_ID`,
  `AMAZON_CREATORS_CLIENT_ID`/`_CLIENT_SECRET`, `SHOPEE_APP_*`,
  `MERCADO_LIVRE_APP_ID`/`_CLIENT_SECRET`/`_REFRESH_TOKEN`, `TELEGRAM_*`,
  `X_*`, `OPENROUTER_API_KEY`/`OPENROUTER_MODEL` — all optional; real
  code paths fall back to mocks / deterministic templates when blank.
  Nothing to fill in unless you specifically want real marketplace data,
  real Telegram/X posting, or real AI-generated content (capped at
  `AI_CONTENT_DAILY_LIMIT`, default 10/day) instead of mocks.
- `SCHEDULE_ENABLED` (default `false`) — turns on the self-scheduled
  ingest+publish routine (`apps/api/src/lib/scheduler.ts`); see
  `SCHEDULE_TIMES`/`SCHEDULE_MARKETPLACES`/`SCHEDULE_PUBLISH_DELAY_MINUTES`/
  `SCHEDULE_PUBLISH_LIMIT` in `.env.example`. Leave off for local dev
  unless you specifically want to test it against real channels.

## Resetting local data

`pnpm db:seed` is **not purely additive** — it starts by calling
`resetDatabase()` (`packages/database/src/seed/reset.ts`), which
`TRUNCATE`s every demo table (categories, products, offers,
deal_candidates, publications, redirects, click_events, conversions)
before reseeding, specifically so it's safe to re-run. `admin_users` is
the one table deliberately left alone, so re-seeding never invalidates
an existing admin login. **Confirm with the user before running
`pnpm db:seed` if they've made manual changes through the admin UI or
API they care about keeping** — those live in the truncated tables and
will be wiped.

```bash
pnpm db:seed
```

Full reset including the schema/admin user too (drops the whole local
Postgres volume — **confirm with the user before running this**, it's
destructive and unrecoverable):

```bash
docker compose -f infra/docker/docker-compose.yml down -v
docker compose -f infra/docker/docker-compose.yml up -d
pnpm db:migrate
pnpm db:seed
```

## Running the test suite

```bash
pnpm test                                              # everything, via turbo
pnpm --filter @dev-das-promos/<pkg> test                # one package, e.g. api, deal-engine
cd packages/<pkg> && pnpm exec vitest run src/__tests__/<file>.test.ts   # one file
```

Postgres and Redis must be up first — `packages/database`, `packages/queue`,
and `apps/api` tests hit the real local instances (not a mock, not a
separate test DB) and will hang or fail at connection time otherwise.
They already carry seed data; any test that inserts rows uses a uniquely
generated id and cleans up only what it created — if you're adding more
tests in these packages, follow that same pattern rather than truncating
a table or assuming it starts empty.
