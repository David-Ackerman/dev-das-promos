# das-promos

A data-driven affiliate deals platform for Amazon Brazil, Shopee Brazil,
and Mercado Livre: it ingests marketplace offers, tracks real price
history, scores deals against a transparent formula, generates
channel-specific content, supports optional human approval, publishes to
Telegram/X/the public web site, tracks clicks and conversions, and feeds
measured outcomes back into scoring. It is the TypeScript-native evolution
of an earlier n8n-only autoposter -- n8n is kept, but only as the
scheduling/ops layer (see [`docs/n8n.md`](./docs/n8n.md)), not as the
place business logic lives.

See [`docs/architecture.md`](./docs/architecture.md) for the full system
diagram and domain model, [`docs/deal-engine.md`](./docs/deal-engine.md)
for exactly how a deal is scored, [`docs/providers.md`](./docs/providers.md)
for the marketplace/publisher abstraction and how to extend it,
[`docs/analytics.md`](./docs/analytics.md) for the click/conversion model,
[`docs/deployment.md`](./docs/deployment.md) for taking this to
production ([`docs/aws-deployment.md`](./docs/aws-deployment.md) for a
complete AWS-specific, credentials-included runbook), and
[`docs/roadmap.md`](./docs/roadmap.md) for what's
designed-for but not yet built.

## Stack

TypeScript (strict), pnpm workspaces + Turborepo, Fastify (API), Next.js
App Router (admin + public site), React, Tailwind v4, TanStack Query,
PostgreSQL + Drizzle ORM, Redis + BullMQ, Zod, Vitest, Biome, Docker
Compose (Postgres/Redis only).

## Package structure

```
apps/
  api/      Fastify HTTP API + BullMQ workers, admin auth, /go/:code redirects
  admin/    Next.js admin dashboard
  web/      Next.js public site (SEO deal/product/category pages)

packages/
  config/          Validated env + scoring weights/thresholds + disclosure copy
  shared/          Money, slugs, hashing, shared types, password hashing
  database/        Drizzle schema, migrations, client, price-history queries, seed data
  deal-engine/     Pure scoring/discount/monetization/approval logic (fully unit tested)
  providers/       MarketplaceProvider abstraction; Amazon Creators API /
                   Shopee Affiliate Open API / Mercado Livre real
                   implementations, each with a mock fallback
  affiliate/       Commission resolution, redirect building, click-tracking helpers
  content-engine/  Deterministic content templates + Publisher abstraction
  queue/           BullMQ queue names, job payload types, connection factory
  analytics/       Click/conversion aggregation queries + pure merge logic

infra/
  docker/          docker-compose.yml (Postgres + Redis only)
  n8n/             n8n workflow documentation

docs/               Architecture, deal-engine, providers, analytics, n8n, roadmap
```

Full rationale for this layout, including why the apps run as a modular
monolith rather than microservices, is in
[`docs/architecture.md`](./docs/architecture.md).

## Local setup

Requires Node 20+, pnpm 10+, and Docker (for Postgres/Redis).

```bash
# 1. Install dependencies
pnpm install

# 2. Copy the env template and fill in secrets (defaults work for local dev)
cp .env.example .env

# 3. Start Postgres + Redis
docker compose -f infra/docker/docker-compose.yml up -d

# 4. Run migrations
pnpm db:migrate

# 5. Seed realistic demo data (categories, products, price history,
#    affiliate programs, scored deals, publications, clicks, conversions)
pnpm db:seed

# 6. Start everything (api on :4000, admin on :3001, web on :3000)
pnpm dev
```

Then:

- Admin dashboard: http://localhost:3001 (log in with `ADMIN_EMAIL` /
  `ADMIN_PASSWORD` from your `.env`, seeded automatically by `db:seed`)
- Public site: http://localhost:3000
- API health check: http://localhost:4000/health

### First-deliverable walkthrough

This exercises the full MVP loop end to end:

1. `pnpm dev` (all three apps + BullMQ workers running).
2. In the admin dashboard, trigger ingestion for a marketplace (or call
   `POST /internal/ingestion/run` with the `X-Internal-Token` header --
   see [`docs/n8n.md`](./docs/n8n.md)). Mock offers are generated
   deterministically by `packages/providers`.
3. Offers are automatically scored (`packages/deal-engine`) and land as
   `DealCandidate`s with status `auto_approved`, `pending`, or `rejected`
   per the configured thresholds.
4. Approve/reject a `pending` deal from `/deals` in the admin dashboard.
5. Publish an approved deal -- content is generated
   (`packages/content-engine`) and sent through the configured (or
   mocked) publishers.
6. Visit the deal on the public site (`/deal/:slug`) -- price history
   chart, score, and the affiliate CTA link are all live.
7. Click the CTA -- it hits `/go/:code`, is tracked (IP hashed, never
   stored raw), and redirects to the marketplace.
8. Check `/analytics` in the admin dashboard for the recorded click.

### Other useful commands

```bash
pnpm test          # run all package/app test suites (Vitest)
pnpm typecheck      # tsc --noEmit across the monorepo
pnpm lint           # Biome check
pnpm build           # build all apps/packages
pnpm db:studio      # Drizzle Studio (inspect the database visually)
```

Per-package: `pnpm --filter @dev-das-promos/<package> <script>` (e.g.
`pnpm --filter @dev-das-promos/deal-engine test`).

Env vars are loaded from this repo's root `.env` -- `apps/api`,
`apps/web`, and `apps/admin` each wrap their scripts with `dotenv-cli`
(`dotenv -e ../../.env -- <command>`) rather than reading a per-app
`.env` file. If you add a new script that needs env vars, wrap it the
same way.

## Key files & entry points

Organized by "I want to change X":

| I want to change... | Look here |
|---|---|
| Scoring weights / approval thresholds | `packages/config/src/scoring-config.ts` (config) + `packages/deal-engine/src/{scoring,discount,components,monetization,approval}.ts` (formula) |
| Disclosure/legal copy per channel | `packages/config/src/disclosure.ts` |
| Database schema | `packages/database/src/schema/*.ts` (one file per table) -- then `pnpm db:generate` + `pnpm db:migrate` |
| Seed/demo data | `packages/database/src/seed/*.ts`, orchestrated by `seed/index.ts` (order matters). **`pnpm db:seed` truncates every demo table first** (`seed/reset.ts`) so it's safely re-runnable -- `admin_users` is the one table deliberately left alone, so re-seeding never invalidates your admin login. Don't run it if you have manual admin-UI/API changes you want to keep. |
| API routes | `apps/api/src/routes/*.ts`, registered in `apps/api/src/app.ts`. `public-*.ts` = no auth; `admin-*.ts` = needs an admin session cookie; `internal.ts` = needs `X-Internal-Token` (n8n) |
| Business logic behind a route | `apps/api/src/services/*.ts` (ingestion, deal-evaluation, approval, publication, redirect, categories, conversion-signal, content-generation) |
| BullMQ workers | `apps/api/src/workers/*.ts`, started in-process by `startWorkers()` in `apps/api/src/server.ts` |
| Admin auth | `apps/api/src/plugins/auth.ts` (session cookie) + `apps/api/src/routes/auth.ts` (login route) + `apps/api/src/lib/internal-auth.ts` (separate `/internal/*` token auth) |
| A marketplace integration | `packages/providers/src/*` (one file per marketplace + `registry.ts`) -- see [`docs/providers.md`](./docs/providers.md) |
| A publishing channel | `packages/content-engine/src/*` (publishers + templates) |
| Public site pages | `apps/web/src/app/**/page.tsx`; shared UI in `apps/web/src/components/*`; API calls via `apps/web/src/lib/api.ts` |
| Admin dashboard pages | `apps/admin/src/app/**/page.tsx`; shared UI in `apps/admin/src/components/*`; API calls via `apps/admin/src/lib/api-client.ts` (browser) / `api-server.ts` (server components, forwards the session cookie) |

## Admin access

- Log in at http://localhost:3001/login with `ADMIN_EMAIL` /
  `ADMIN_PASSWORD` from `.env`.
- That login row is created by `pnpm db:seed`
  (`packages/database/src/seed/admin.ts`), which is a no-op if the email
  already exists -- changing `ADMIN_EMAIL`/`ADMIN_PASSWORD` in `.env`
  *after* the first seed does **not** update an already-seeded admin.
  Either seed with a new email, or edit the `admin_users` row directly
  (`pnpm db:studio` is the easiest way).
- Session mechanism: a cookie signed with `AUTH_SECRET`, issued by
  `POST /auth/login` (`apps/api/src/routes/auth.ts`) and checked on every
  `admin-*` route by `apps/api/src/plugins/auth.ts`.

## Environment variables

See [`.env.example`](./.env.example) for the full annotated list, validated
at startup by `packages/config/src/env.ts` (zod). Highlights:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `REDIS_URL` | yes | Redis connection string (BullMQ) |
| `API_PORT`, `API_URL`, `ADMIN_URL`, `PUBLIC_WEB_URL` | yes | Service URLs; `API_URL` is also where `/go/:code` lives |
| `INTERNAL_API_TOKEN` | yes | Shared secret for n8n-facing `/internal/*` routes |
| `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | yes | Admin session signing + seeded admin login |
| `AMAZON_AFFILIATE_TAG`, `SHOPEE_AFFILIATE_ID`, `MERCADO_LIVRE_AFFILIATE_ID` | no | Marketplace mocks work without these |
| `AMAZON_CREATORS_CLIENT_ID`, `AMAZON_CREATORS_CLIENT_SECRET` | no | Activates the real Amazon provider (Creators API -- replaces the retired PA-API 5.0, see `docs/providers.md`) |
| `SHOPEE_APP_ID`, `SHOPEE_APP_SECRET` | no | Activates the real Shopee provider (Affiliate Open API) |
| `MERCADO_LIVRE_APP_ID`, `MERCADO_LIVRE_CLIENT_SECRET`, `MERCADO_LIVRE_REFRESH_TOKEN` | no | Activates the real Mercado Livre provider; requires a one-time manual OAuth2 setup, see `docs/providers.md` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | no | Falls back to `MockPublisher` when absent |
| `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` | no | Activates real X posting (OAuth 1.0a); falls back to `MockPublisher` when absent |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | no | Activates the real AI-backed `ContentGenerator` (OpenRouter); the default template generator needs neither |
| `AI_CONTENT_DAILY_LIMIT` | no (default `10`) | Caps AI-generated posts per UTC day, comfortably under OpenRouter's free-tier request cap |
| `SCHEDULE_ENABLED` | no (default `false`) | Turns on the self-scheduled ingest + publish routine -- see "Automated posting routine" below |
| `SCHEDULE_TIMES`, `SCHEDULE_MARKETPLACES`, `SCHEDULE_PUBLISH_DELAY_MINUTES`, `SCHEDULE_PUBLISH_LIMIT` | no | Configure the routine's times/marketplaces/batch size; see `docs/deployment.md` |

## Automated posting routine

`apps/api/src/lib/scheduler.ts` can self-schedule the whole ingest ->
score -> publish loop using BullMQ job schedulers already running inside
the same process -- no separate cron host or n8n setup required to go
live. Set `SCHEDULE_ENABLED=true` plus `SCHEDULE_TIMES` (comma-separated
24h UTC `HH:mm`, e.g. `09:00,13:00,17:00,21:00` for 4x/day) and
`SCHEDULE_MARKETPLACES`. At each configured time it ingests fresh offers
for every configured marketplace; `SCHEDULE_PUBLISH_DELAY_MINUTES` (default
15) later, it publishes up to `SCHEDULE_PUBLISH_LIMIT` (default 5) of the
highest-scoring deals that are approved but not yet published --
`packages/database`'s `dealCandidates.status` flipping to `"published"`
is what keeps a deal from being re-published on the next cycle, so this
always reflects whatever is currently ready, never stale/reprocessed
data. Off by default so dev/CI never spontaneously post to real
Telegram/X channels; changing the schedule needs an env change + restart
(see `docs/roadmap.md` for the n8n-driven/UI-editable upgrade path).

## What's mocked vs. real

- **Marketplace data** (`packages/providers`): real integrations exist for
  Amazon (Creators API), Shopee (Affiliate Open API), and Mercado Livre,
  each behind a `create<X>Provider(credentials?)` factory that falls back
  to the deterministic mock provider when the real credentials aren't
  configured -- no scraping, no undocumented APIs. See
  [`docs/providers.md`](./docs/providers.md) for exactly which env vars
  activate each real integration.
- **Telegram publishing**: real (calls the Bot API), with an automatic
  mock fallback when no bot token is configured.
- **X (Twitter) publishing**: real (OAuth 1.0a-signed `POST /2/tweets`),
  with an automatic mock fallback when credentials aren't configured.
- **Web publishing**: trivially real -- "publishing" to the site is just
  making the deal query-able through `/public/*`.
- **Content generation**: two implementations. The default,
  `TemplateContentGenerator`, is fully deterministic (template-based),
  free, and needs no credentials. `OpenRouterContentGenerator` is a real
  AI-backed alternative (see `docs/providers.md`) that activates when
  `OPENROUTER_API_KEY`/`OPENROUTER_MODEL` are set, capped at
  `AI_CONTENT_DAILY_LIMIT` (default 10) AI-generated posts per day to
  stay on OpenRouter's free tier -- falls back to templates automatically
  once the daily quota is spent, or if a call fails for any reason.
- **Conversion data**: seeded synthetically for demo purposes
  (`packages/database/src/seed/conversions.ts`); the click-tracking path
  itself (`/go/:code`) is fully real.

## Adding a marketplace or a publication channel

Both are one-file-plus-registry-entry changes by design -- see
[`docs/providers.md`](./docs/providers.md) for the exact steps.

## How deal scoring works

Short version: a weighted formula (30% real historical discount, 20%
advertised discount, 15% commission, 10% seller rating, 10% popularity,
10% conversion rate, 5% freshness), where "real discount" is computed
against an observed 90-day (or 30-day, or advertised-price-fallback)
price average rather than trusting the marketplace's own "was" price. Full
formula, saturation curves, and approval thresholds are in
[`docs/deal-engine.md`](./docs/deal-engine.md).

## Testing

`pnpm test` runs the full suite (281 tests as of this writing) across
every package and app via Turborepo. Coverage breakdown:

- `deal-engine`, `affiliate`, `content-engine`, `providers`, `analytics`,
  `shared`, `config` -- pure unit tests, no infrastructure needed.
- `queue`, `database`, `apps/api` -- integration tests that run against
  your **real local Postgres/Redis** (the same ones `pnpm dev` uses, not
  a separate test database or mocks), so Docker must be up first
  (`docker compose -f infra/docker/docker-compose.yml up -d`). These
  tests only ever insert rows with randomly-generated ids and clean up
  exactly what they created in `afterAll` -- they never truncate a table
  or touch pre-existing seed data, and it's safe to run them against a
  DB you're also using for manual testing.
- `apps/web`, `apps/admin` -- component/lib tests via Vitest + jsdom +
  React Testing Library. Async server components under `src/app/**` that
  fetch live data aren't covered by design -- they're exercised by
  running the app itself, not unit tests.

```bash
pnpm test                                            # everything
pnpm --filter @dev-das-promos/<pkg> test              # one package (e.g. api, deal-engine)
cd packages/<pkg> && pnpm exec vitest run src/__tests__/<file>.test.ts   # one file
pnpm typecheck                                       # tsc --noEmit, whole monorepo
```
