# Roadmap / designed-for-but-not-implemented

This platform's architecture deliberately leaves room for the following
without requiring a rewrite. Nothing below is implemented in the MVP --
this page exists so the next engineer (or a future session) knows what was
anticipated and where the seam already is.

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

`apps/api` runs the Fastify server and all five BullMQ workers
(`packages/queue`'s `QUEUE_NAMES`) in one process today (see
`docs/architecture.md`'s "modular monolith" note). Splitting a queue's
worker into its own deployable process is a config/deployment change
(point a second process at `startWorkers()`, stop starting workers inline
in the HTTP process) with no code restructuring required if/when ingestion
or content-generation volume outgrows a single process.

## Deal expiration

`dealCandidateStatusEnum` already includes `"expired"`, but nothing
currently transitions a deal into it. A scheduled job (n8n-triggered, or a
sixth BullMQ queue) that marks stale published deals expired once their
offer is no longer available (`availability: "out_of_stock"` on the latest
offer, or no fresh offer observed in N days) is the natural next piece --
`docs/architecture.md`'s ingestion sequence already produces the signal
(availability on each `offers` row) this would key off of.
