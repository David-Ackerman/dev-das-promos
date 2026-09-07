# infra/docker

Docker Compose definition for the platform's stateful dependencies:
PostgreSQL and Redis. This is intentionally the *only* thing containerized.

## Why not containerize the Node apps too?

- Local dev is faster without an image rebuild on every file change.
- Each app (`apps/api`, `apps/admin`, `apps/web`) is a normal Node/Next.js
  process and deploys independently to whatever platform is chosen later
  (a container platform, a Node PaaS, etc.) -- baking that decision into a
  single docker-compose file this early would be premature.
- Postgres and Redis are the only pieces that need a consistent, disposable,
  local-parity environment during development.

## Usage

From the repository root:

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

This starts:

- **postgres** on `localhost:5432` (user `postgres`, password `postgres`,
  database `das_promos`) -- matches the default `DATABASE_URL` in
  `.env.example`.
- **redis** on `localhost:6379` -- matches the default `REDIS_URL` in
  `.env.example`.

Both services have healthchecks; wait for them to report healthy (or just
retry the migration/seed commands, which fail fast on a closed connection)
before running `pnpm db:migrate`.

To stop:

```bash
docker compose -f infra/docker/docker-compose.yml down
```

Add `-v` to also drop the named Postgres volume (`das-promos-postgres`) and
start from an empty database next time.
