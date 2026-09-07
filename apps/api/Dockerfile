# apps/api runs as tsx (not a compiled `node dist/server.js`) in every
# environment, including this image. Reason: every workspace package
# resolves via its package.json "main" straight to TypeScript source
# (`./src/index.ts`), and none of them has its own build/dist step -- so
# a plain-Node run of apps/api's own tsc output still fails at import
# time trying to load "@dev-das-promos/*" packages, which are unbuilt
# `.ts` files. Compiling every package to real dist output is a real,
# larger refactor (see README.md's "Key files & entry points"); until
# that happens, tsx-in-production is the correct, working choice, not a
# shortcut -- it's exactly how `pnpm dev` already runs this app.
#
# Build from the MONOREPO ROOT, not this directory, so the workspace
# lockfile/packages are in the build context:
#   docker build -f apps/api/Dockerfile -t das-promos-api .
#
# Uses `turbo prune` to build only apps/api's actual dependency subgraph
# (packages/admin and packages/web's own deps are excluded), keeping the
# image and the install step smaller than copying the whole monorepo.

FROM node:22-alpine AS base
RUN corepack enable

# ---- Prune the monorepo down to apps/api's real dependency graph ----
FROM base AS pruner
WORKDIR /app
COPY . .
RUN npx turbo prune @dev-das-promos/api --docker

# ---- Install deps against the pruned lockfile (cache-friendly layer) ----
FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
# Installs devDependencies too on purpose: `tsx` runs the app (see header
# comment) and several workspace packages are consumed as TS source, so
# there's no meaningful "prod-only" install for this repo today.
RUN pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ .

# ---- Runtime ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S nodejs && adduser -S fastify -G nodejs
COPY --from=installer --chown=fastify:nodejs /app .
USER fastify

WORKDIR /app/apps/api
EXPOSE 4000

# Real env vars come from the platform (Fly/Railway/ECS/etc secrets), not
# a .env file -- this CMD intentionally does not use dotenv-cli, unlike
# the local "pnpm dev"/"pnpm start" scripts.
CMD ["node_modules/.bin/tsx", "src/server.ts"]
