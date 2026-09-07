# n8n integration

n8n is used as the **scheduling and operations layer** on top of this
platform, not as a place business logic lives. See
[`infra/n8n/README.md`](../infra/n8n/README.md) for the full, workflow-by-
workflow specification (scheduled ingestion, Telegram approval
notifications, publication triggers, a manual admin command workflow, and
error notifications) -- this page covers the contract n8n talks to and why
the split is drawn where it is.

## Why n8n calls the API instead of embedding logic

Every workflow in `infra/n8n/README.md` does one of two things: call an
`apps/api` endpoint, or react to that endpoint's response (branch, notify,
retry). Scoring (`packages/deal-engine`), content generation
(`packages/content-engine`), and the approval-threshold decision all live
in the TypeScript codebase, where they are:

- **typed** -- a scoring formula change is caught by `tsc` and the
  deal-engine test suite, not discovered at 2am when an n8n workflow
  silently miscalculates a percentage.
- **tested** -- `packages/deal-engine/src/__tests__` exhaustively covers
  the scoring/discount/monetization/approval logic; n8n workflows have no
  equivalent unit-testing story.
- **versioned in git** -- reviewable in a PR, not a JSON export a
  non-engineer edited in a web UI and forgot to re-export.

n8n's job is orchestration: *when* to call ingestion, *when* to nudge a
human for review, *when* to trigger publication, and *what to do on
failure* -- all things that benefit from n8n's visual, non-engineer-
editable cron/branch/notify model.

## The internal API surface

All n8n-facing routes live under `/internal/*`
(`apps/api/src/routes/internal.ts`) and are guarded by a shared-secret
header compared in constant time
(`apps/api/src/lib/internal-auth.ts`, using `crypto.timingSafeEqual`):

```
X-Internal-Token: <INTERNAL_API_TOKEN>
```

This is deliberately **not** the admin session cookie -- n8n is a service
credential, not an impersonated logged-in admin, and it never receives or
stores an admin password.

| Route | Purpose |
|---|---|
| `POST /internal/ingestion/run` | Enqueue an `offer-ingestion` job for a marketplace (optionally scoped to a category) |
| `POST /internal/deals/:id/approve` | Approve a deal (recorded with `reviewedBy: "n8n"`) |
| `POST /internal/deals/:id/reject` | Reject a deal (recorded with `reviewedBy: "n8n"`) |
| `POST /internal/deals/:id/re-evaluate` | Re-run scoring for a deal |
| `POST /internal/deals/:id/publish` | Enqueue content generation + publication for an approved deal |

Workflows that only need to *read* state (e.g. "list deals pending
review") use the same `/admin/*` routes the dashboard uses, authenticated
with a session cookie obtained via `POST /auth/login` in an earlier n8n
node -- there's no separate read API to keep in sync with the dashboard's.

## What must never move into n8n

- Deal scoring, discount calculation, or approval-threshold logic.
- Generating post copy for a deal.
- Marketplace or affiliate credentials (these stay in `apps/api`'s
  environment only).

See `infra/n8n/README.md`'s "What n8n must never do" section for the full
list with rationale per item.
