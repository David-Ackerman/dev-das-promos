# CLAUDE.md

Small affiliate-deals bot. Full overview and setup in [README.md](./README.md).

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
  byte for byte: never rewrite them, or the affiliate tag can be lost.
- Approve must stay idempotent: `transition(db, id, "pending", "publishing")`.
  Retry goes through the same gate from `failed`/`partial` and skips every
  destination already in `publications` as sent, so nothing is posted twice.

## Commands
```bash
npm test          # node:test; flow tests need TEST_DATABASE_URL (real Postgres)
npm run typecheck
npm run collect:dry
```
