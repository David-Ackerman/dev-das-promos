# Roadmap / deferred and partially implemented capabilities

This platform's architecture deliberately leaves room for the capabilities
below without requiring a rewrite. Some foundations already exist (such as
the Mercado Livre provider and query-time deal expiration); each section
describes what remains before that capability is complete. This page records
work deferred beyond the launch MVP and the seams already in place.

## An editable UI/n8n-driven schedule

`apps/api/src/lib/scheduler.ts` self-schedules the ingest+publish routine
via BullMQ job schedulers, configured entirely through env vars
(`SCHEDULE_TIMES`, `SCHEDULE_MARKETPLACES`, etc. -- see
`docs/deployment.md`). Changing the schedule today means editing `.env`
and restarting the process -- there's no UI, and no way for a
non-engineer to adjust posting times based on observed engagement without
a deploy. Two upgrade paths, not mutually exclusive: (1) an admin-UI
settings page that calls `registerScheduledJobs()` with new values at
runtime instead of only at boot, or (2) move the scheduling to n8n
(`infra/n8n/README.md`'s original intent) by having n8n call
`POST /internal/ingestion/run` and a new `POST /internal/deals/publish-ready`
route on its own cron nodes instead of `apps/api` self-scheduling --
`services/scheduled-publish.ts`'s `publishReadyDeals()` is already a
standalone function independent of the BullMQ scheduler, so exposing it
as a route is a small, isolated change either way.

## More marketplaces

Mercado Livre has been added (`packages/providers/src/mercado-livre.ts`,
mock + real `MercadoLivreApiProvider`) alongside Amazon and Shopee. The
`Marketplace` union (`packages/shared/src/types.ts`) and
`marketplaceEnum` (`packages/database/src/schema/enums.ts`) are the two
places a new marketplace is registered, and the rest of the pipeline
(ingestion, scoring, redirect, analytics) stays marketplace-agnostic --
see "Adding a new marketplace provider" in `docs/providers.md` for the
exact steps if another one is added later.


## Channel-attributed conversions

Documented today as a known limitation in `docs/analytics.md`: conversions
are recorded against a `DealCandidate`, not the specific `Publication`/
channel that drove the click. Closing this requires either richer
marketplace postback data (sub-ID passthrough, where supported) or a
first-click/last-click attribution model recorded at conversion time in
`apps/api`'s conversion-ingestion path.

## Push-based n8n triggers

The Telegram approval-notification workflow in `infra/n8n/README.md`
today polls `GET /admin/deals?status=pending`. A push variant -- an
outbound webhook call from the deal-evaluation worker
(`apps/api/src/workers/deal-evaluation.worker.ts`) the moment a deal lands
in `pending` -- removes the polling delay and the need to track "already
notified" IDs in n8n.

## Configurable / A-B-tested scoring weights

`scoreDeal()` already takes `DealScoreWeights` as a parameter rather than
a hardcoded constant (`packages/deal-engine/src/scoring.ts`). The seam for
per-category or experiment-driven weight overrides is there; what's
missing is a place to store and select between multiple named weight sets
(likely a small `scoring_profiles` table plus an admin UI to edit it,
rather than only the current single `DEFAULT_DEAL_SCORE_WEIGHTS`).

## Multi-worker / separated deployment

`apps/api` runs the Fastify server and all six BullMQ workers
(`packages/queue`'s `QUEUE_NAMES`) in one process today (see
`docs/architecture.md`'s "modular monolith" note). Splitting a queue's
worker into its own deployable process is a config/deployment change
(point a second process at `startWorkers()`, stop starting workers inline
in the HTTP process) with no code restructuring required if/when ingestion
or content-generation volume outgrows a single process.

## Deal expiration

An out-of-stock observation now transitions a candidate to `"expired"`.
Public and scheduled-publishing queries also exclude out-of-stock offers
and observations older than 72 hours, so stale deals cannot be shown or
newly published. Affiliate redirects also reject deals that are no longer
published or whose offer is out of stock or older than 72 hours, including
links saved in old channel posts. A future cleanup job should persist
`"expired"` for deals whose latest observation simply ages past 72 hours;
today those deals are hidden by the query filter but retain their previous
database status until another observation is evaluated.
