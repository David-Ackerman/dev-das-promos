# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A data-driven affiliate deals platform (Amazon BR / Shopee BR): ingests
marketplace offers, tracks real price history, scores deals against a
transparent formula, generates content, supports optional human approval,
publishes to Telegram/X/the public site, and tracks clicks/conversions
back into scoring. Full narrative in [README.md](./README.md); deep dives
in `docs/architecture.md`, `docs/deal-engine.md`, `docs/providers.md`,
`docs/analytics.md`, `docs/n8n.md`.

## Commands

Local infra (Postgres + Redis) must be running before `dev`, `db:*`, or
any `test` that touches `apps/api`/`packages/database`/`packages/queue`:

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

```bash
pnpm install
cp .env.example .env        # placeholder values are sufficient for local dev
pnpm db:migrate
pnpm db:seed                 # creates the admin login, demo categories/products/deals
pnpm dev                     # api :4000, admin :3001, web :3000
```

```bash
pnpm test                    # every package/app, via turbo
pnpm --filter @dev-das-promos/<pkg> test     # one package (e.g. deal-engine, api)
cd packages/<pkg> && pnpm exec vitest run src/__tests__/<file>.test.ts   # one file
pnpm typecheck                # tsc --noEmit across the monorepo
pnpm lint / pnpm lint:fix     # Biome (2-space, 100-col, organizeImports on)
pnpm build                    # turbo build across apps/packages
pnpm db:generate              # regenerate drizzle migrations after a schema change
pnpm db:studio                # Drizzle Studio
```

Admin login: `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` (seeded into
`admin_users` by `pnpm db:seed`, via `packages/database/src/seed/admin.ts`
— re-running seed is idempotent and skips creation if that email already
exists).

## Architecture

**Modular monolith, not microservices.** `apps/api` runs the Fastify HTTP
server *and* all BullMQ workers in the same process
(`apps/api/src/server.ts` → `startWorkers()`). The queue boundary
(`packages/queue`) already exists in the code, so splitting a worker into
its own deployable process later is a deploy change, not a rewrite.

**Dependency direction is strictly apps → packages**, and among packages,
`deal-engine`/`affiliate`/`content-engine`/`providers` depend only on
`config` and `shared` — never on `database` or an app. That's what keeps
`deal-engine` fully unit-testable with zero infrastructure (no DB, no
HTTP). When adding logic, put anything that doesn't need I/O in the
lowest-dependency package it can live in, not in `apps/api/src/services`.

**Pipeline**: n8n (external, cron-driven) hits `POST
/internal/ingestion/run` with `X-Internal-Token` → enqueues
`offer-ingestion` → provider mock fetches offers → upserts
product/marketplaceProduct, inserts an `offer` row → enqueues
`deal-evaluation` → `scoreDeal()` + `estimateMonetization()` → upserts
`deal_candidates` (one row per product+marketplace pairing, matched by
slug; a human review decision survives re-evaluation) → auto-approved
scores enqueue `content-generation` immediately, others wait in
`apps/admin` for a human approve/reject → `content-generation` →
`publication` per channel → public site reads via `/public/*` (ISR,
60s revalidate) → user click hits `/go/:code` → resolves the redirect,
records a `click_event` (IP hashed, never stored raw), 302s to the
marketplace. Full sequence diagram in `docs/architecture.md`.

**Domain modeling decisions worth knowing before touching schema/queries**:
- Money is always integer cents (`*Cents` columns) — see
  `packages/shared/src/money.ts`. Never floats; format to BRL only at the
  display layer.
- Price history is derived, not stored: `offers` is an append-only
  observation log, and `packages/database/src/price-history.ts` computes
  7d/30d/90d averages/minimums in one query via `FILTER (WHERE ...)`.
- IDs are app-generated UUIDv4 text primary keys
  (`packages/database/src/schema/columns.ts`), not `gen_random_uuid()`,
  to avoid a Postgres extension dependency.

**Fastify plugins register in `apps/api/src/app.ts`**: `security` → `db`
→ `queues` → `auth`, then routes. Every plugin that opens a resource
(Postgres pool, Redis connection, BullMQ queues) must close it in an
`onClose` hook — both `apps/api/src/plugins/queues.ts` (`connection.disconnect()`)
and `db.ts` (`db.$client.end()`) already do this; follow the same pattern
for any new resource.

**`ContentGenerator` has two implementations** (`packages/content-engine`):
`TemplateContentGenerator` (default, deterministic, free) and
`OpenRouterContentGenerator` (AI-backed, real, falls back to templates
when unconfigured or on any failure — see `docs/providers.md`). The
per-deal daily AI quota (`apps/api/src/lib/ai-content-quota.ts`) is
Redis-backed using the **same raw connection `server.ts` already creates
for BullMQ workers** (`createRedisConnection`, threaded through
`startWorkers` → `createContentGenerationWorker` → `generateContentForDeal`),
not a new connection — BullMQ's own `Queue.client` getter deliberately
exposes a minimal adapter interface with no raw `incr`/`expire`, so don't
reach for that when you need real Redis commands elsewhere; get the raw
connection the same way instead.

## Repo-wide gotchas

**Relative imports use a `.js` extension on `.ts` source files**
(`from "./foo.js"` where only `foo.ts` exists) — a deliberate NodeNext-ESM
convention used in every package. `tsx` and Vitest resolve this
correctly, but tools with their own single-file transpilers do not
resolve it on their own:
- `drizzle-kit` (via `esbuild-register`) can't resolve it — that's why
  `packages/database`'s `db:generate`/`db:studio` scripts run through
  `tsx ./node_modules/drizzle-kit/bin.cjs ...` instead of the bare
  `drizzle-kit` CLI.
- Next.js's webpack bundler can't resolve it either — both
  `apps/web/next.config.mjs` and `apps/admin/next.config.mjs` set
  `webpack: (config) => { config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] }; ... }`
  to compensate. Don't remove that, and don't "fix" the import style
  instead — it's consistent across the whole codebase on purpose.

**Env vars are loaded per-app from the repo-root `.env`**, not from a
per-app `.env` file: `apps/api`, `apps/web`, and `apps/admin` all wrap
their `dev`/`build`/`start`/`test` scripts with
`dotenv -e ../../.env -- <command>` (`dotenv-cli`, already a
devDependency in each). If you add a new script that needs env vars,
wrap it the same way rather than adding a per-app `.env` file.

`apps/api/src/env.ts` calls `loadEnv()` (from `@dev-das-promos/config`,
Zod-validated) eagerly at import time — a missing/invalid required var
(`DATABASE_URL`, `REDIS_URL`, `INTERNAL_API_TOKEN`, `AUTH_SECRET`, ≥16
chars for the last two) crashes the process immediately with a listed
error, before the server ever binds a port.

**Test data hygiene**: `packages/database` and `apps/api` tests run
against the real local dev Postgres/Redis (not a mock, not a separate
test DB), which already carries seed data from `pnpm db:seed`. Any test
that inserts rows must use a randomly-generated id/prefix and delete only
what it created in `afterAll` — never truncate a table or touch
pre-existing seeded rows. Any test that opens a raw DB/Redis
connection/queue must close it, or `vitest run` hangs on exit.
