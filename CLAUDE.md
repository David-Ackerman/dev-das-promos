# CLAUDE.md

Small affiliate-deals bot. Full overview and setup in [README.md](./README.md);
how the parts fit together in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) (keep it
up to date when you add a route, cron, workflow, table or provider).

## Shape
- **No build step.** Node 22.18+ runs `.ts` directly (type stripping). Use only
  erasable TypeScript: no `enum`, no `namespace`, no constructor parameter
  properties. Relative imports use the real `.ts` extension.
- **Two runtimes, one codebase:**
  - GitHub Actions runs `src/jobs/*.ts` (collect, migrate, set-webhook) with
    a TCP Postgres connection (`src/db-node.ts`, `postgres` package).
  - The Cloudflare Worker (`src/worker.ts` → `src/http.ts`) talks to Neon over
    HTTP (`@neondatabase/serverless`). Code reachable from `http.ts` must not
    import `node:*` modules or `db-node.ts`; use `fetch` and WebCrypto.
- All SQL lives in `src/repo.ts` behind the tiny `Db` interface (`src/db.ts`).
- Settings come only from env vars (`src/config.ts`, documented in
  `.env.example`). In GitHub, every repo Variable/Secret is exported
  automatically by `src/jobs/gh-export-env.ts`; Worker settings are the
  `WORKER_KEYS` list in `src/jobs/worker-secrets.ts`, so add new Worker
  settings there.

## Rules
- Database: migrations in `migrations/` are append-only and never rolled
  back. Never DROP/TRUNCATE/DELETE (enforced by `test/unit.test.ts`).
- Money is integer cents.
- The AI never writes prices or links; `src/render.ts` adds them.
- Links the admin sends (`src/manual.ts`) are stored as `affiliate_url`
  byte for byte: never rewrite them, or the affiliate tag can be lost. The one
  exception is an Amazon link without the admin's `AMAZON_PARTNER_TAG`
  (`affiliateLinkFor`): it becomes `amazon.com.br/dp/<ASIN>?tag=<tag>`.
- Amazon product data comes from links the admin sends, the official API, or
  the opt-in search-page reader (`src/providers/amazon-scrape.ts`, only with
  `AMAZON_SCRAPE=on`, which the owner chose knowing it can conflict with the
  Associates agreement). Keep it off by default and polite (few requests,
  pauses, stop at the first captcha); never crawl Amazon anywhere else.
- Photos: a post's own photo (AI scene) lives in Telegram (`posts.image_file_id`)
  and is served at `/img/<id>.jpg`; `posts.image_url` points there and
  `POST_SELECT` returns it as `image_url` (else the store photo). The image
  model must keep the product identical and add no text (`src/images.ts`).
- Approve must stay idempotent: it wins `transition(db, id, "pending", ...)`
  once (to `publishing`, or to `queued` when the queue is on); a queued post is
  published only through `transition(db, id, "queued", "publishing")`. Retry
  goes through the same gate from `failed`/`partial` and skips every
  destination already in `publications` as sent, so nothing is posted twice.

## Commands
```bash
npm test          # node:test; flow tests need TEST_DATABASE_URL (real Postgres)
npm run typecheck
npm run collect:dry
```
