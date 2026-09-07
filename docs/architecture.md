# Architecture

## System overview

das-promos is a TypeScript monorepo (pnpm workspaces + Turborepo) with
three deployable apps and nine framework-independent packages.

```mermaid
flowchart LR
    subgraph Marketplaces
        AMZ[Amazon Brazil]
        SHO[Shopee Brazil]
    end

    subgraph apps/api [apps/api - Fastify]
        ING[Ingestion service]
        EVAL[Deal evaluation]
        CONTENT[Content generation]
        PUB[Publication]
        GO["/go/:code redirect"]
        ADMIN_API[Admin + public REST routes]
        INTERNAL[/internal/* n8n routes/]
        WORKERS[BullMQ workers]
    end

    subgraph Data
        PG[(PostgreSQL)]
        REDIS[(Redis / BullMQ)]
    end

    subgraph Frontends
        ADMIN_UI[apps/admin - Next.js]
        WEB[apps/web - Next.js public site]
    end

    N8N[n8n - scheduling & ops]

    AMZ -. mocked provider .-> ING
    SHO -. mocked provider .-> ING
    ING --> REDIS
    REDIS --> WORKERS
    WORKERS --> EVAL --> PG
    WORKERS --> CONTENT --> PG
    WORKERS --> PUB --> PG
    ADMIN_API --> PG
    GO --> PG
    ADMIN_UI -->|admin session cookie| ADMIN_API
    WEB -->|public REST, ISR| ADMIN_API
    N8N -->|X-Internal-Token| INTERNAL
    INTERNAL --> REDIS
    Users((End users)) -->|click| GO
    Users -->|browse| WEB
```

## Why a modular monolith, not microservices

`apps/api` runs the Fastify HTTP server **and** the BullMQ workers in the
same Node process (see `apps/api/src/server.ts`). For this platform's
scale (a handful of marketplaces, a moderate offer volume), splitting
ingestion/evaluation/content/publication into separate deployable services
would add operational overhead (more processes to deploy, monitor, and
version) without a corresponding benefit. The queue boundary
(`packages/queue`) is still there in the code, so extracting a queue's
worker into its own process later is a deployment change, not a rewrite --
just point a new process at `startWorkers()` and stop running workers
inline in the API process.

## Package structure

```
apps/
  api/      Fastify HTTP API + BullMQ workers (ingestion, scoring, content,
            publication, analytics), admin auth, /go/:code redirects
  admin/    Next.js admin dashboard (approve/reject/publish deals, browse
            products, view analytics) -- talks to apps/api with a session
            cookie
  web/      Next.js public site (SEO deal/product/category pages) -- talks
            to apps/api's /public/* routes with ISR caching

packages/
  config/          Validated env loading (zod) + scoring weights/thresholds
                    + disclosure copy. No dependency on any other package.
  shared/           Money (integer cents), slugs, hashing, shared zod enums,
                    Result<T,E>, password hashing.
  database/        Drizzle ORM schema, migrations, typed client, derived
                    price-history queries, seed data generators.
  deal-engine/     Pure, framework-independent scoring/discount/monetization/
                    approval logic. No DB, no HTTP -- fully unit tested.
  providers/        MarketplaceProvider abstraction + Amazon BR / Shopee BR
                    mock implementations + deterministic mock catalog.
  affiliate/       Commission resolution, redirect code generation/URL
                    building, privacy-conscious click-tracking helpers.
  content-engine/  Deterministic template-based deal copy generator +
                    Publisher abstraction (Telegram/X/Web + mocks).
  queue/           BullMQ queue names, job payload types, connection/queue
                    factories.
  analytics/       Click/conversion aggregation queries + pure merge logic.

infra/
  docker/          docker-compose.yml for Postgres + Redis only.
  n8n/             n8n workflow documentation (scheduling/ops layer).

docs/               This directory.
```

Dependency direction is strictly apps → packages, and within packages,
`deal-engine`/`affiliate`/`content-engine`/`providers` depend only on
`config` and `shared` -- never on `database` or an app. That's what keeps
`deal-engine` unit-testable with zero infrastructure.

## Domain model

```mermaid
erDiagram
    CATEGORY ||--o{ CATEGORY : "parent/children"
    CATEGORY ||--o{ PRODUCT : has
    PRODUCT ||--o{ MARKETPLACE_PRODUCT : "listed as"
    MARKETPLACE_PRODUCT ||--o{ OFFER : "observed over time"
    MARKETPLACE_PRODUCT ||--o{ DEAL_CANDIDATE : "scored as"
    OFFER ||--o| DEAL_CANDIDATE : "scored from"
    CATEGORY ||--o{ AFFILIATE_PROGRAM : "commission override"
    DEAL_CANDIDATE ||--o{ PUBLICATION : "published to channels"
    PUBLICATION ||--o| REDIRECT : "tracked via"
    REDIRECT ||--o{ CLICK_EVENT : records
    DEAL_CANDIDATE ||--o{ CONVERSION : "attributed to"
```

Key modeling decisions:

- **Money is always integer cents** (`*Cents` columns), never floats --
  see `packages/shared/src/money.ts`. Formatting to BRL happens only at
  the display layer.
- **Price history is derived, not duplicated.** `offers` is an append-only
  observation log; `packages/database/src/price-history.ts` computes
  7d/30d/90d averages and minimums with a single SQL query using
  `FILTER (WHERE ...)` clauses, so there's nothing to keep in sync.
- **`deal_candidates` is upserted by slug**, one row per active
  product+marketplace pairing (see `evaluateOffer()` in
  `apps/api/src/services/deal-evaluation.ts`). Re-ingesting an offer
  re-scores the same DealCandidate rather than creating a new row, and a
  human decision (`reviewedBy` set) is preserved across re-evaluation
  unless explicitly re-run.
- **IDs are app-generated UUIDv4 text primary keys** (`crypto.randomUUID()`
  in `packages/database/src/schema/columns.ts`), not `gen_random_uuid()`,
  to avoid a Postgres extension dependency.

## Request flow: ingestion → public deal page

```mermaid
sequenceDiagram
    participant N8N as n8n (cron)
    participant API as apps/api
    participant Q as BullMQ
    participant DB as PostgreSQL
    participant Admin as apps/admin
    participant Web as apps/web
    participant User

    N8N->>API: POST /internal/ingestion/run {marketplace}
    API->>Q: enqueue offer-ingestion job
    Q->>API: worker picks up job
    API->>API: provider.fetchOffers() (mock)
    API->>DB: upsert product/marketplaceProduct, insert offer
    API->>Q: enqueue deal-evaluation job
    Q->>API: worker picks up job
    API->>API: scoreDeal() + estimateMonetization()
    API->>DB: upsert deal_candidate (status via applyApprovalThresholds)
    alt score >= auto-approve threshold
        API->>Q: enqueue content-generation job automatically
    else score in human-review band
        Admin->>API: GET /admin/deals?status=pending
        Admin->>API: POST /admin/deals/:id/approve
    end
    API->>Q: enqueue content-generation job
    API->>DB: generate content, create redirect, store publications (queued)
    API->>Q: enqueue publication job per channel
    API->>DB: publisher.publish() -> update publication + deal status
    Web->>API: GET /public/deals/:slug (ISR, revalidate 60s)
    User->>API: GET /go/:code
    API->>DB: resolve redirect, insert click_event (async, hashed IP)
    API-->>User: 302 to marketplace affiliate URL
```

See [`docs/deal-engine.md`](./deal-engine.md) for the scoring formula,
[`docs/providers.md`](./providers.md) for the marketplace/publisher
abstraction, [`docs/analytics.md`](./analytics.md) for the click/conversion
model, and [`docs/n8n.md`](./n8n.md) for how the orchestration layer above
maps to n8n workflows.
