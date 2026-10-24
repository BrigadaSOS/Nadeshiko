# Build from the repository root so npm workspaces resolve the root manifests and lockfile. Usage: docker build -f
# backend/Dockerfile .
FROM node:24.22.1-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
WORKDIR /build

# `npm ci` reconciles the whole workspace set against the root lockfile, so every
# workspace manifest has to be present even though only `backend` is installed.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY discord/package.json discord/
COPY packages/nadeshiko-sdk/package.json packages/nadeshiko-sdk/
COPY packages/nadeshiko-shared/package.json packages/nadeshiko-shared/
# Runtime uses tsx, so omit dev dependencies; generators are not shipped or run in the deployed container.
# npm ci also builds discord's plain better-sqlite3 dependency even for this backend image; --omit=optional cannot
# remove it, and node:24-slim needs Python/make/g++ for node-gyp. Keep all workspace manifests for the lockfile; the
# compiler is discarded with the build stage, so the release image is unchanged.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN npm ci --workspace backend --include-workspace-root --omit=dev

COPY backend backend
# This shared package is imported at runtime, unlike the adjacent SDK manifest-only dependency, so its source must ship.
COPY packages/nadeshiko-shared packages/nadeshiko-shared

# Flatten the workspace into /app so documented kamal exec and corpus-reparse commands resolve from the deployed working
# directory; include scripts because reparse runs against the deployed database.
RUN set -eux; \
  mkdir -p /app/node_modules; \
  cp -a node_modules/. /app/node_modules/; \
  if [ -d backend/node_modules ]; then cp -a backend/node_modules/. /app/node_modules/; fi; \
  cp -a --parents packages/nadeshiko-shared /app/; \
  cd backend; \
  cp -a package.json tsconfig.json main.ts instrumentation.ts app config db bin lib scripts generated /app/; \
  node -e "require.resolve('tsx',{paths:['/app']})"; \
  node -e "require.resolve('@brigadasos/nadeshiko-shared/traffic',{paths:['/app']})"

FROM node:24.22.1-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS release
WORKDIR /app
COPY --from=build /app /app
USER node

# Leave memory beyond V8 old space for database/search/telemetry buffers; this is not a total-heap cap. Keep
# SEARCH_STATS_CACHE bounded rather than masking leaks; change this cap and deployment memory together.
ENV NODE_OPTIONS=--max-old-space-size=1024

# Docker sets net.ipv4.ip_unprivileged_port_start=0, so the unprivileged `node`
# user can still bind the PORT 80 the deploy configs use.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||80)+'/up').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT []
CMD ["node", "--import", "tsx", "--import", "./instrumentation.ts", "main.ts"]
