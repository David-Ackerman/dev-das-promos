# infra/n8n

n8n is the **orchestration/scheduling layer**, not where business logic
lives. Every workflow described here is a thin wrapper that calls an
`apps/api` HTTP endpoint at the right time and reacts to the response --
scoring, approval-threshold logic, content generation and publishing all
happen inside the TypeScript codebase (`packages/deal-engine`,
`packages/content-engine`, `apps/api/src/services/*`), where they're typed,
tested, and reviewable in git.

This directory intentionally contains **documentation and exportable
workflow JSON**, not a running n8n instance -- n8n is expected to be hosted
separately (self-hosted or n8n Cloud) and pointed at this platform's API.

## Authentication

Every workflow below calls one or more `/internal/*` routes on `apps/api`.
These routes are guarded by a shared-secret header, **not** the admin
session cookie (n8n is a service, not a logged-in human):

```
X-Internal-Token: <INTERNAL_API_TOKEN>
```

Set `INTERNAL_API_TOKEN` in n8n's credential store to match the value
configured in the API's environment. The API compares it with a
constant-time check (`crypto.timingSafeEqual`) -- see
`apps/api/src/lib/internal-auth.ts`.

Base URL: use the deployed `API_URL` (e.g. `https://api.daspromos.com` in
production, `http://localhost:4000` locally).

## Workflow 1 -- Scheduled marketplace ingestion

**Trigger:** Cron (e.g. every 2 hours per marketplace, staggered so both
marketplaces aren't hit at the same minute).

**Steps:**
1. Cron node fires.
2. HTTP Request node: `POST {{API_URL}}/internal/ingestion/run`
   ```json
   { "marketplace": "amazon_br" }
   ```
   (a second branch/workflow does the same with `"marketplace": "shopee_br"`,
   optionally with `"category": "gaming"` etc. to shard the crawl)
3. The API enqueues an `offer-ingestion` BullMQ job and returns
   `{ "queued": true, "marketplace": "amazon_br" }` immediately -- ingestion,
   scoring, and (if the score clears the auto-approve threshold) content
   generation all happen asynchronously inside `apps/api`'s workers.
4. (Optional) IF node checks the HTTP status; on non-2xx, branch to
   Workflow 5 (error notification).

**Why n8n and not a cron job inside apps/api?** So non-engineers can see,
pause, and adjust ingestion cadence per marketplace/category without a
deploy, and so ingestion scheduling is visible next to the other business
workflows below.

## Workflow 2 -- Telegram approval notification

**Trigger:** Webhook (n8n exposes a webhook URL; the API calls it -- see
note below) **or** Cron polling `GET /admin/deals?status=pending` if a
push webhook isn't wired up yet. `pending` is the deal-engine's status for
"score cleared the human-review threshold but not the auto-approve one" --
see `applyApprovalThresholds()` in `packages/deal-engine/src/approval.ts`.

**Steps (polling variant, simplest to stand up first):**
1. Cron node fires every N minutes.
2. HTTP Request: `GET {{API_URL}}/admin/deals?status=pending` (uses an
   admin session cookie obtained via `POST /auth/login` in a earlier node,
   cached across runs -- **not** the internal token, since this is reading
   the same data an admin would see in the dashboard).
3. For each deal in the response not yet notified (track seen IDs in an n8n
   data store or a lightweight external KV), send a Telegram message via
   the Telegram node summarizing: product name, score, discount %, price --
   with two inline buttons.
4. Telegram inline button callback → HTTP Request:
   `POST {{API_URL}}/internal/deals/:id/approve` or
   `POST {{API_URL}}/internal/deals/:id/reject` (internal-token auth).

**Push variant (better, once ready):** add an outbound webhook call from
`apps/api`'s deal-evaluation worker when a deal lands in `pending`, and
replace the Cron node above with an n8n Webhook trigger. This is a
future-facing change noted in `docs/roadmap.md` -- the polling variant above
works today with zero API changes.

## Workflow 3 -- Publication trigger

**Trigger:** Cron (e.g. every 15 minutes) or the same webhook pattern as
Workflow 2.

**Steps:**
1. HTTP Request: `GET {{API_URL}}/admin/deals?status=approved` (or
   `auto_approved`) to find deals that are ready but not yet published.
2. For each: HTTP Request `POST {{API_URL}}/internal/deals/:id/publish`.
3. The API enqueues content generation → publication across the configured
   channels (Telegram/X/Web) via `packages/content-engine`'s publishers.
   n8n does not construct captions or call Telegram/X APIs directly for
   deal content -- it only tells the platform "publish this one now".

## Workflow 4 -- Manual admin command

**Trigger:** n8n Form Trigger or a Telegram bot command (`/ingest amazon_br`,
`/approve <dealId>`, `/publish <dealId>`) restricted to an allow-listed
Telegram user/chat ID.

**Steps:**
1. Parse the command.
2. Route to the matching `/internal/*` endpoint (same three used above),
   with the internal token.
3. Reply in Telegram with the result.

This gives operators a manual override without needing to open the admin
dashboard, using the exact same internal endpoints as the scheduled flows --
no separate code path to keep in sync.

## Workflow 5 -- Error notification

**Trigger:** Error Trigger node, attached to every workflow above.

**Steps:**
1. n8n's built-in Error Trigger captures the failed node/workflow/message.
2. Send a message to a dedicated ops Telegram chat (different from the
   public deals channel) or email, including the workflow name and error.

Keep this generic and reusable across all workflows above rather than
duplicating error handling per workflow.

## What n8n must never do

- Compute a deal score, discount percentage, or approval decision -- that
  is `packages/deal-engine`'s job, called from `apps/api`.
- Generate post copy -- that is `packages/content-engine`'s job.
- Talk to Telegram/X on behalf of a *deal* publication (Workflow 3's job is
  to say "publish deal X", not to build the message itself). n8n's own
  Telegram node in Workflows 2/4/5 is fine because those are operator/ops
  notifications, not customer-facing deal content.
- Hold marketplace or affiliate credentials -- those stay in `apps/api`'s
  environment, never in an n8n credential meant for a different purpose.

## Exporting workflows

Once workflows are built in an n8n instance, export each as JSON
(`... → Download`) and commit it here as `infra/n8n/workflows/<name>.json`
so the orchestration layer is versioned alongside the code it calls. No
workflow JSON is checked in yet -- this README is the spec to build them
from.
