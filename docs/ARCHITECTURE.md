# Architecture

How **Dev das Promos** is put together: which service runs where, what each
part does, and how they talk to each other. Everything runs on free plans
except the optional pay-per-use X API.

- [1. The big picture](#1-the-big-picture)
- [2. Where each part runs](#2-where-each-part-runs)
- [3. Deploying](#3-deploying)
- [4. Main flows](#4-main-flows)
- [5. Life of a post](#5-life-of-a-post)
- [6. Data model](#6-data-model)
- [7. Reference](#7-reference)

## 1. The big picture

Three hosted services and a handful of external APIs:

```mermaid
flowchart TB
  subgraph people["People"]
    direction LR
    admin["👤 Admin"]
    members["👥 Group members"]
    visitors["🌐 Site visitors"]
  end

  subgraph channels["Channels"]
    direction LR
    telegram["Telegram Bot API"]
    xapi["X API v2"]
    wa["WhatsApp<br/>share / Evolution / Z-API"]
  end

  subgraph compute["Compute"]
    direction LR
    subgraph cloudflare["Cloudflare (free)"]
      worker["Worker <b>das-promos</b><br/>bot · /go · site · queue · roundup<br/>+ cron triggers + static assets"]
    end
    subgraph github["GitHub (free)"]
      gha["GitHub Actions<br/>collect · heal · deploy · backup"]
    end
  end

  subgraph neon["Neon (free, São Paulo)"]
    db[("Postgres")]
  end

  subgraph external["External APIs"]
    direction LR
    stores["Stores<br/>Shopee API · Amazon · Mercado Livre"]
    ai["AI<br/>Groq → Gemini → OpenRouter"]
  end

  admin <-->|"previews, ✅ ❌ 🔄 ✏️, links"| telegram
  members -->|"read posts"| channels
  members -->|"click /go/code"| worker
  visitors -->|"GET /"| worker
  telegram <-->|"webhook / replies"| worker
  worker -->|"posts"| xapi & wa
  worker -->|"workflow_dispatch"| gha
  gha -->|"previews, alerts"| telegram
  worker -->|"HTTP"| db
  gha -->|"TCP"| db
  worker & gha --> stores
  worker & gha --> ai
```

**In one sentence:** GitHub Actions does the heavy, slow work (searching stores,
writing captions with time to spare), the Cloudflare Worker does everything that
must answer instantly or on a clock (the bot, tracked links, the public page, the
publishing queue), and Neon Postgres is the single source of truth both share.

## 2. Where each part runs

| Provider | Part | What it does | Code |
|---|---|---|---|
| **Cloudflare Workers** | Worker `das-promos` | Telegram webhook (buttons, commands, links sent by the admin), tracked redirects `/go`, WhatsApp/X share pages, public deals page, publishing to the channels | `src/worker.ts` → `src/http.ts` |
| | Cron triggers | Start the deal search, publish the queue, propose the weekly Top 10 | `wrangler.toml`, `scheduled()` in `src/http.ts` |
| | Static assets | Banner and link-preview image of the site | `public/` |
| **GitHub Actions** | `collect.yml` | Deal search: stores → ranking → AI caption → preview to the admin | `src/jobs/collect.ts` → `src/collect.ts` |
| | `heal.yml` | Rewrites captions that fell back to a template when the Worker ran out of time | `src/jobs/heal.ts` |
| | `deploy.yml` | Tests, backup, migrations, Worker deploy, Worker settings, Telegram webhook | see [Deploying](#3-deploying) |
| | `backup.yml` | Daily `pg_dump`, kept 90 days as an artifact | — |
| | `ai-check.yml` | Measures how often the AI writes the caption (manual) | `src/jobs/ai-check.ts` |
| | `ci.yml` | Typecheck + tests on pull requests (and inside `deploy.yml`) | `test/` |
| **Neon** | Postgres | Products, price history, posts, links, clicks, deliveries, roundups, X spend | `migrations/`, all SQL in `src/repo.ts` |
| **Shopee** | Affiliate Open API (GraphQL) | Offer search, affiliate short links (post ref as sub-id), price check by item | `src/providers/shopee.ts` |
| **Amazon** | Creators API · product pages | Search (needs an eligible account); pages read for links the admin sends and price checks | `src/providers/amazon.ts`, `src/manual.ts` |
| **Mercado Livre** | Product / showcase pages | `meli.la` affiliate links open the showcase; the featured card gives name, photo, price | `src/manual.ts` |
| **Groq · Gemini · OpenRouter** | Chat completions | One-joke captions + brand hashtag; tried in order, each with its own free quota | `src/ai.ts` |
| **Telegram** | Bot API | Previews and buttons for the admin, posts in the groups, banners on ended deals | `src/telegram.ts`, `src/bot.ts` |
| **X** | API v2 (pay-per-use) | Post without link + product photo, reply with the link, within the budget | `src/publishers/x.ts`, `src/publish.ts` |
| **WhatsApp** | Share link · Evolution · Z-API | One-tap share for the admin, or automatic sending through a gateway | `src/publishers/whatsapp.ts`, `src/share.ts` |
| **GitHub API** | `workflow_dispatch` | Lets the Worker (cron, `/buscar`, AI retry) start Actions workflows | `triggerCollect` in `src/bot.ts` |

**Two runtimes, one codebase.** The same TypeScript runs in both places (Node
22.18+ runs `.ts` directly, no build step). Code the Worker reaches must use only
`fetch` and WebCrypto, never `node:*` modules or the TCP database driver:

```mermaid
flowchart TB
  subgraph node["GitHub Actions — Node"]
    jobs["src/jobs/*.ts"] --> dbnode["db-node.ts<br/>(postgres, TCP)"]
  end
  subgraph edge["Cloudflare Worker"]
    w["worker.ts"] --> neonhttp["@neondatabase/serverless<br/>(HTTP)"]
  end
  shared["Shared, fetch-only modules<br/>collect · publish · ai · manual · pricecheck<br/>render · preview · telegram · providers · publishers"]
  repo["repo.ts — all SQL, behind the tiny Db interface (db.ts)"]
  jobs --> shared
  w --> shared
  shared --> repo
  dbnode --> pg[("Neon Postgres")]
  neonhttp --> pg
  repo -. "Db.query" .-> dbnode & neonhttp
```

## 3. Deploying

A push to `main` runs `deploy.yml`. Each step stops the deploy if it fails.

```mermaid
flowchart LR
  push["git push main"] --> test["ci.yml<br/>typecheck + tests<br/>(real Postgres)"]
  test --> env["Load every repo<br/>Variable/Secret<br/>(gh-export-env.ts)"]
  env --> backup["pg_dump backup<br/>(artifact, 30 days)"]
  backup --> migrate["Apply new<br/>migrations<br/>(additive only)"]
  migrate --> wrangler["wrangler deploy<br/>Worker + crons + assets"]
  wrangler --> secrets["Upload Worker settings<br/>(worker-secrets.ts)"]
  secrets --> hook["Point the Telegram<br/>webhook at the Worker"]
  hook --> smoke["GET /health"]
```

Settings live only in GitHub (**Settings → Environments → production**); the
deploy hands the Worker the subset it needs (`WORKER_KEYS` in
`src/jobs/worker-secrets.ts`). A Worker setting changes only on the next deploy;
Actions jobs read settings fresh on every run.

## 4. Main flows

### 4.1 Deal search (5× a day)

GitHub's own scheduler runs late or skips runs, so a Worker cron starts the
search on time through the GitHub API.

```mermaid
sequenceDiagram
  autonumber
  participant Cron as Worker cron<br/>(9h, 12h, 15h, 18h, 21h)
  participant GH as GitHub Actions<br/>collect.yml
  participant DB as Neon
  participant Shopee
  participant AI as Groq → Gemini → OpenRouter
  participant TG as Telegram
  participant Admin

  Cron->>GH: workflow_dispatch (GitHub API)
  GH->>DB: expire stale previews, unstick "publishing", retry template captions
  GH->>Shopee: re-check deals of the last 3 days
  GH->>TG: sold out / pricier → banner on the group messages
  GH->>Shopee: search each keyword (SHOPEE_KEYWORDS)
  GH->>DB: save products + price snapshot
  Note over GH: rank by discount + commission + sales + rating<br/>skip cooldown, BLOCKED_WORDS, fake discounts
  loop each pick (POSTS_PER_RUN)
    GH->>Shopee: affiliate short link (sub-id = post ref)
    GH->>AI: one-joke caption + hashtag (90 s budget)
    GH->>DB: create post (pending)
    GH->>TG: preview with ✅ ❌ 🔄 ✏️
    TG->>Admin: preview
    opt AUTO_APPROVE_MIN_DISCOUNT
      GH->>DB: approve → queue
    end
  end
```

### 4.2 Approval, queue and publishing

```mermaid
sequenceDiagram
  autonumber
  participant Admin
  participant TG as Telegram
  participant W as Worker
  participant DB as Neon
  participant Store as Store (price)
  participant X as X API
  participant Groups as Telegram groups

  Admin->>TG: ✅ Aprovar
  TG->>W: webhook (callback a:id)
  W->>DB: pending → queued, slot = last post + QUEUE_INTERVAL_MINUTES
  W->>TG: preview "🕒 Agendado para 14:40" + ⚡ ↩️ ✏️
  Note over W: Every 5 min (cron), inside POSTING_HOURS,<br/>spacing kept even for overdue posts
  W->>DB: queued → publishing (only one caller wins)
  W->>Store: current price
  alt price went up
    W->>DB: back to pending, new price
    W->>TG: "💸 O preço subiu" + ✅ to publish anyway
  else sold out
    W->>DB: expired
  else same or lower
    loop each group (TELEGRAM_GROUP_IDS)
      W->>Groups: post with its own /go link
    end
    opt X_MODE=thread, within daily limit, store rule and budget
      W->>X: upload product photo
      W->>X: post without link
      W->>X: reply with /go link (if today's budget allows)
    end
    W->>DB: deliveries, X spend, status published / partial / failed
    W->>TG: preview "✅ Publicado" (+ 📲 WhatsApp, 🔁 retry if something failed)
  end
```

`⚡ Publicar agora` skips the wait; `↩️ Desagendar` puts the post back to a
preview; `🔁 Tentar de novo` re-sends only to the channels that failed.

### 4.3 Clicks

Every channel and group gets its own short code, so `/stats` can compare them.

```mermaid
sequenceDiagram
  participant User as Person in a group / site / X
  participant W as Worker /go/:code
  participant DB as Neon
  participant Store as Store (affiliate link)

  User->>W: GET /go/aB3dE7x
  W->>DB: resolve code → post's affiliate link
  W-->>User: 302 redirect (answered before logging)
  User->>Store: lands on the product (commission tracked by the store)
  W->>DB: click: is_bot (preview robots), country, hashed IP
```

### 4.4 Links the admin sends (Amazon, Mercado Livre)

```mermaid
sequenceDiagram
  participant Admin
  participant W as Worker
  participant Page as Store page
  participant AI as AI providers
  participant GH as heal.yml

  Admin->>W: "https://meli.la/… 129,90" (private chat)
  W->>Page: follow the link, read name / photo / price
  Note over W: typed prices win<br/>Mercado Livre showcase: the featured card only
  W->>AI: caption (15 s, the Worker's window)
  alt every model busy
    W->>GH: start "AI texts retry"
    GH->>W: (via DB + Telegram) preview updated in 1–2 min
  end
  W->>Admin: preview with ✅ ❌ 🔄 ✏️ — the link is kept byte for byte
```

### 4.5 Scheduled jobs

| When (Brasília) | Who | What |
|---|---|---|
| Every 5 min | Worker cron `*/5 * * * *` | Publish the next queued post whose time has come |
| 9h, 12h, 15h, 18h, 21h | Worker cron `7 0,12,15,18,21 * * *` | Start `collect.yml` (deal search) |
| Sundays 18h | Worker cron `0 21 * * SUN` | Weekly Top 10 preview for the admin |
| Daily ~3h | GitHub schedule (`backup.yml`) | `pg_dump` backup |
| On demand | Worker → `heal.yml` | Rewrite captions that fell back to a template |

Cloudflare numbers weekdays 1–7 or `SUN`–`SAT`; a rejected cron throws out every
schedule of the deploy, so `test/unit.test.ts` checks them.

## 5. Life of a post

```mermaid
stateDiagram-v2
  [*] --> pending: search / link sent by admin
  pending --> queued: ✅ (queue on)
  pending --> publishing: ✅ (queue off) / slot is now
  pending --> declined: ❌
  pending --> expired: no answer in PENDING_TTL_HOURS
  pending --> failed: preview could not be sent
  queued --> publishing: cron at its slot / ⚡
  queued --> pending: ↩️
  publishing --> published: every channel OK
  publishing --> partial: some channels failed
  publishing --> failed: all failed / stuck > 15 min
  publishing --> pending: price went up
  publishing --> expired: sold out
  partial --> publishing: 🔁
  failed --> publishing: 🔁
  published --> [*]
```

Moving a post between states is always one SQL `UPDATE … WHERE status = <from>`
(`transition()` in `src/repo.ts`): if two taps or a tap and the cron race, only
one wins, so nothing is ever posted twice. Published deals can later get
`deal_ended_at` (sold out / pricier banner) without changing their status.

## 6. Data model

```mermaid
erDiagram
  products ||--o{ price_snapshots : "price history"
  products ||--o{ posts : "suggested as"
  posts ||--o{ links : "one per channel + group"
  links ||--o{ clicks : "tracked"
  posts ||--o{ publications : "delivery attempts"
  posts ||--o{ x_usage : "paid X calls"

  products {
    int id PK
    text marketplace "amazon | shopee | mercadolivre"
    text external_id "ASIN / itemId / MLB…"
    text title
    text image_url
    text product_url
  }
  price_snapshots {
    bigint id PK
    int product_id FK
    int price_cents
    int original_price_cents
    timestamptz captured_at
  }
  posts {
    int id PK
    int product_id FK
    text ref "Shopee sub-id"
    text status "see 'Life of a post'"
    int price_cents
    int discount_pct
    int lowest_seen_cents "30-day history"
    text affiliate_url "kept byte for byte"
    text caption
    text caption_short "X"
    text hashtag "X"
    text ai_model "model | template | manual"
    timestamptz scheduled_at "queue"
    boolean price_from_admin
    timestamptz deal_ended_at
  }
  links {
    text code PK "short code in /go"
    int post_id FK
    text channel "telegram | whatsapp | x | web"
    text target "group id"
  }
  clicks {
    bigint id PK
    text code FK
    boolean is_bot
    text country
    text ip_hash
    timestamptz clicked_at
  }
  publications {
    int id PK
    int post_id FK
    text channel
    text target
    text status "sent | failed | manual"
    text external_id "message / tweet id"
  }
  x_usage {
    int id PK
    int post_id FK
    text kind "post | reply"
    numeric cost_usd
  }
  roundups {
    int id PK
    int_array post_ids
    text status "pending | sent | declined"
  }
  site_views {
    date day PK
    text source PK "x | ig | share | '' = direct"
    int views
  }
```

**Data safety:** migrations are append-only and never roll back; `DROP`,
`TRUNCATE` and `DELETE` are rejected by a test. Every deploy and every night
saves a `pg_dump`, and Neon can restore any point of the last hours. Money is
always integer cents.

## 7. Reference

### Worker routes

| Route | Purpose |
|---|---|
| `GET /`, `/ofertas` | Public page with the live deals of the last 7 days. `?src=x\|ig\|tt\|yt\|tg\|wa\|share\|google` (bio and share links) gives each source its own "web" links and visit count (`site_views`) |
| `GET /go/:code` | Tracked redirect to the affiliate link (`HEAD` doesn't count as a click) |
| `GET /wa/:code` | Opens WhatsApp with the post written |
| `GET /x/:code` | Page to copy the X post or open it in the X app (share mode) |
| `GET /wr/:id` | Opens WhatsApp with the weekly Top 10 written |
| `POST /telegram/webhook` | Bot updates (checked with `TELEGRAM_WEBHOOK_SECRET`) |
| `GET /robots.txt`, `/health` | Search engines; deploy smoke test |
| `/banner*.webp`, `/og.jpg` | Static assets from `public/` |

### Bot

| Command / button | Effect |
|---|---|
| `/pendentes`, `/fila` | Previews waiting; posts waiting for their slot |
| `/stats [dias]` | Clicks per channel, group and site source (`web x`…), site visits per source, store, best hours, top products, X spend |
| `/buscar` | Search now (starts `collect.yml`) |
| `/resumo` | Weekly Top 10 preview |
| `/id` | Chat id (for setting up groups) |
| Link in the private chat | Preview from an Amazon / Mercado Livre link |
| ✅ ❌ 🔄 ✏️ | Approve, decline, new AI text, write your own text |
| ⚡ ↩️ | Publish a queued post now; back to preview |
| 🔁 | Retry only the channels that failed |

### Source map

| File | Responsibility |
|---|---|
| `src/collect.ts` | Search run: ranking, cooldowns, fake-discount filter, auto-approve, healing |
| `src/publish.ts` | Approve / queue / publish, price check gate, X thread rules, ended deals |
| `src/bot.ts` | Telegram commands and buttons, links sent by the admin |
| `src/http.ts` | Worker routes and cron dispatch |
| `src/ai.ts` | Prompt, model fallback across providers, reply parsing |
| `src/manual.ts` | Reading store pages for links the admin sends |
| `src/pricecheck.ts` | Current price (Shopee API / store page) |
| `src/schedule.ts` | Queue slots and posting window |
| `src/render.ts`, `src/preview.ts` | Post text per channel; admin preview |
| `src/site.ts`, `src/roundup.ts`, `src/share.ts` | Public page, weekly Top 10, share links |
| `src/providers/*`, `src/publishers/*` | Store APIs; X / WhatsApp senders |
| `src/repo.ts` | All SQL |
| `src/config.ts` | Every setting (documented in `.env.example`) |
| `src/jobs/*` | Entry points for GitHub Actions and npm scripts |
