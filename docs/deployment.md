# Deployment

This is the infrastructure checklist for taking das-promos to production.
It assumes Phase 1 (real marketplace/publisher integrations) is either
done or intentionally deferred -- see `docs/providers.md` for the status
of each integration. Nothing here requires Phase 1 to be complete; a
demo/staging deploy running on the mock providers is a valid way to
validate this checklist first.

Deploying specifically to AWS with real credentials end-to-end (which
marketplace to launch with, exact registration steps per provider, and
how to verify a real affiliate link before trusting the automated
routine)? See `docs/aws-deployment.md` for the complete, self-contained
runbook -- this page stays the platform-agnostic version.

## Cheapest/simplest path: one VM running everything

Run Postgres + Redis + `apps/api` together on a single always-on VM via
`infra/docker/docker-compose.prod.yml` (verified working end-to-end:
built, migrated, and served real requests during this work) -- no
managed-services bill, no separate container platform to configure. This
needs a real always-on VM, not a sleep-on-idle serverless free tier,
which is incompatible with the scheduled routine below (it needs the
process alive continuously to fire at scheduled times, not just on
inbound requests). Two VM options that both work with the exact same
Dockerfile/compose file, zero code differences:

- **AWS EC2, paid for with existing credit** -- the straightforward
  choice if credit is already available: no free-tier signup friction,
  no capacity/region availability issues, no history of a provider
  reclaiming the instance. A `t3.small` (2GB RAM -- Postgres + Redis +
  the Node process together want more headroom than `t3.micro`'s 1GB)
  running Amazon Linux or Ubuntu works fine. Steps: launch the instance,
  open inbound port 4000 (and 22 for SSH) in its security group, SSH in,
  install Docker + the Docker Compose plugin, then the same commands as
  below. Pair with **RDS** (managed Postgres) and/or **ElastiCache**
  (managed Redis) later instead of the containers in the compose file if
  you want automated backups without self-managing them -- not required
  to launch, `docker-compose.prod.yml`'s Postgres/Redis containers are a
  fine starting point.
- **Oracle Cloud "Always Free"** -- genuinely $0 forever (2 OCPU/12GB
  RAM Ampere A1 as of this writing) if credit isn't already sitting
  elsewhere, but has real friction: identity verification during
  signup, occasional "out of capacity" errors for the free ARM shape in
  some regions, and a documented history of Oracle quietly shrinking or
  reclaiming free-tier instances without much notice.

```bash
# On the VM itself (build there, not elsewhere + push -- avoids needing
# a container registry or cross-architecture image builds):
git clone <this repo> && cd dev-das-promos
cp .env.example .env    # then edit with real production secrets
docker compose -f infra/docker/docker-compose.prod.yml up -d --build

# One-time (and after any schema change): run migrations inside the container
docker compose -f infra/docker/docker-compose.prod.yml exec api \
  sh -c "cd /app/packages/database && pnpm exec tsx src/migrate.ts"
```

`apps/web`/`apps/admin` still go to Vercel's free tier (section 3 below)
rather than onto this same VM -- keeps it simple and Vercel's free tier
is genuinely a good fit for those. Skip straight to "3. apps/web and
apps/admin" once this is running; sections 1-2 below are the
fully-managed-services alternative (Neon/Upstash/etc. instead of
self-hosted containers) if/when that's worth it.

## 1. Postgres + Redis (managed-services alternative)

`infra/docker/docker-compose.yml` is dev-only by its own header comment
-- it has no backup strategy, no HA, and isn't sized for production load.
Move to managed instances:

- **Postgres**: Neon, Supabase, RDS, or any managed Postgres 16+. Enable
  automated backups / point-in-time recovery from day one -- this is the
  system of record for every deal, click, and conversion.
- **Redis**: Upstash, ElastiCache, or any managed Redis 7+. BullMQ
  (`packages/queue`) needs `maxRetriesPerRequest: null` on the connection
  (already set in `packages/queue/src/connection.ts` -- no config needed
  on your end beyond the connection URL).

Set `DATABASE_URL` / `REDIS_URL` on `apps/api` to the managed instances'
connection strings. Run `pnpm db:migrate` against the prod database
**before** deploying app code that depends on a new schema, never after.
Do **not** run `pnpm db:seed` against prod -- see the "Resetting local
data" section of the `das-promos-local-dev` skill (`.claude/skills/`) for
exactly why (it truncates domain tables on every run; it's a dev/demo
tool, not a prod seeding mechanism). Create the real admin login either
by seeding once against an empty prod database with real
`ADMIN_EMAIL`/`ADMIN_PASSWORD`, or by inserting the `admin_users` row
directly.

## 2. `apps/api` (Fastify + BullMQ workers)

A working, tested `Dockerfile` is at `apps/api/Dockerfile`. Build it from
the **monorepo root** (it needs the workspace lockfile and every package
`apps/api` depends on in the build context):

```bash
docker build -f apps/api/Dockerfile -t das-promos-api .
```

Why this image runs the app via `tsx` instead of a compiled
`node dist/server.js`: every workspace package resolves through its
`package.json` `"main"` straight to TypeScript source (there is no
per-package build step in this repo today), so a plain-Node run of
`apps/api`'s own compiled output still fails trying to import
`@dev-das-promos/*` packages. This was verified directly -- `node
dist/server.js` throws `ERR_MODULE_NOT_FOUND` on the first cross-package
import. `apps/api/package.json`'s `start` script was fixed to use `tsx`
to match (this is also exactly how `pnpm dev` already runs the app, so
it's not a new/different code path for prod, just the existing one). A
"real" compiled-JS image is possible later but needs a build step added
to every package first -- a larger, separate refactor, not required to
ship.

The image was built and run end-to-end against the local Postgres/Redis
during this work and confirmed serving real data through `/health` and
`/public/categories` -- it's a verified starting point, not a guess.

Deploy target: anywhere that runs a long-lived container and lets you set
env vars as secrets -- Fly.io, Railway, Render, or ECS/Fargate all work.
**This cannot be a serverless/functions platform** (Vercel functions,
Lambda) because the BullMQ workers (`apps/api/src/workers/*`, started
in-process by `startWorkers()` in `server.ts`) need a persistent,
long-running process, not a request-scoped one.

Required env vars on the deployed container (see `.env.example` for the
full annotated list): `DATABASE_URL`, `REDIS_URL`, `API_PORT`, `API_URL`,
`ADMIN_URL`, `PUBLIC_WEB_URL`, `INTERNAL_API_TOKEN`, `AUTH_SECRET`,
`ADMIN_EMAIL`, `ADMIN_PASSWORD`, plus whichever marketplace/publisher
credentials Phase 1 wired up (`AMAZON_CREATORS_*`, `SHOPEE_APP_*`,
`MERCADO_LIVRE_*`, `X_*`, `TELEGRAM_*`). **Generate fresh values for
`AUTH_SECRET`/`INTERNAL_API_TOKEN`/`ADMIN_PASSWORD`** (e.g. `openssl rand
-hex 32`) -- never reuse the `.env.example` placeholders. On the
single-VM path above, these come from the root `.env` via `env_file` in
`docker-compose.prod.yml`; on a platform-hosted container, the platform's
own secrets manager should inject them directly into the container's env
instead (the image itself does not read a `.env` file).

### The automated posting routine

Set `SCHEDULE_ENABLED=true` (off by default) plus `SCHEDULE_TIMES`
(comma-separated 24h **UTC** `HH:mm`, e.g. `09:00,13:00,17:00,21:00` for
4x/day -- convert your actual local "good engagement" times to UTC) and
`SCHEDULE_MARKETPLACES` to turn on the self-scheduled ingest → publish
loop (`apps/api/src/lib/scheduler.ts`, README's "Automated posting
routine" section has the full mechanics). No n8n or external cron needed
-- it runs inside the same `apps/api` process via BullMQ job schedulers.
Verify it registered by checking the container logs for a `[scheduler]
registered N ingest+publish cycle(s)/day for [...]` line right after
boot.

## 3. `apps/web` and `apps/admin` (Next.js)

No Dockerfile needed for these -- deploy straight to Vercel (zero-config
for a Next.js App Router project) pointed at each app's directory
(`apps/web`, `apps/admin` as separate Vercel projects). Set
`NEXT_PUBLIC_API_URL` and `API_URL` to the deployed API's real URL on
each. If you'd rather containerize them instead (e.g. to keep everything
on one platform), the same `turbo prune`-based pattern
`apps/api/Dockerfile` uses applies, swapping the final `CMD` for
`next start`.

## 4. n8n (scheduling/ops layer) -- optional now

With `SCHEDULE_ENABLED=true` (above), `apps/api` self-schedules ingestion
and publishing -- n8n is no longer required to have a working automated
loop live. n8n remains worth adding later for the approval-notification
workflow and for non-engineer-editable timing (`infra/n8n/README.md`,
`docs/n8n.md`, `docs/roadmap.md`'s "editable UI/n8n-driven schedule"
item) -- n8n is deliberately excluded from `docker-compose.yml`/`.prod.yml`
and hosted separately (self-hosted or n8n Cloud) when you do add it.
Point it at the deployed `API_URL` with the real `INTERNAL_API_TOKEN` in
its credential store.

## 5. DNS + TLS

Point real domains/subdomains at each deployed service (e.g.
`api.yourdomain.com`, `admin.yourdomain.com`, `yourdomain.com`). Most
platforms above (Vercel, Fly.io, Railway, Render) provision TLS
certificates automatically once a custom domain is attached -- no manual
cert management needed unless self-hosting behind your own reverse proxy.

## Pre-launch checklist

- [ ] `pnpm db:migrate` run against prod, `pnpm db:seed` **not** run
      against prod (or run exactly once against an empty database if you
      want the demo dataset)
- [ ] Every secret rotated from the `.env.example` placeholder values
- [ ] `apps/api` deployed as a long-running container (not serverless),
      `/health` returns 200
- [ ] `apps/web`/`apps/admin` deployed and pointed at the real `API_URL`
- [ ] If using n8n: pointed at the prod `API_URL` with the real
      `INTERNAL_API_TOKEN`. If using the self-scheduled routine instead:
      `SCHEDULE_ENABLED=true` and `SCHEDULE_TIMES` set to real UTC times,
      container logs show the `[scheduler] registered ...` line on boot
- [ ] TLS live on every public-facing domain
- [ ] Error tracking wired up (nothing exists today beyond Fastify's
      built-in pino logging -- see `README.md`'s roadmap notes)
- [ ] Real marketplace/publisher credentials verified end-to-end with a
      real (low-volume) ingest → score → approve → publish → click run
      before opening up to real traffic -- **Amazon note**: two of the
      Creators API's fields are inferred rather than confirmed (see
      `docs/providers.md`), verify Amazon ingestion produces sane data
      before trusting it at volume
