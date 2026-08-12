# Build from the repository root, not from backend/: npm workspaces resolve the
# API's dependencies against the root package.json and package-lock.json.
#
#   docker build -f backend/Dockerfile .
FROM node:24-slim AS build
WORKDIR /build

# `npm ci` reconciles the whole workspace set against the root lockfile, so every
# workspace manifest has to be present even though only `backend` is installed.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY discord/package.json discord/
COPY packages/nadeshiko-sdk/package.json packages/nadeshiko-sdk/
# The image runs TypeScript directly through tsx, which is a regular dependency,
# so --omit=dev keeps everything the runtime needs. Nothing under app/, config/,
# db/, lib/ or generated/ imports a devDependency; the bin/ scripts that do
# (generateBrunoCollection, generateErrorProfiles, ...) are code generators that
# only ever run in dev and CI, never in a deployed container.
# A TOOLCHAIN, FOR A MODULE THIS SERVICE DOES NOT USE. `npm ci` reconciles the
# whole workspace set (see above), so `better-sqlite3` -- discord's driver, and an
# optional peer of typeorm and better-auth -- is installed here even though the
# API only ever talks to Postgres. It publishes no prebuilt binaries at all, so
# npm runs `node-gyp rebuild`, and node:24-slim has no Python: the build dies on
# a driver nothing imports.
#
# This surfaced on 2026-08-12 after an unrelated version bump moved which copy
# won hoisting -- from `discord/node_modules`, which this image never installs,
# to the root, which it does. Nothing about the API changed. That it worked
# before was luck about placement, not a property anyone had chosen.
#
# `--omit=optional` does NOT fix it: the copy that gets built is discord's, and
# there it is a plain dependency. Removing discord's manifest is not an option
# either -- `npm ci` needs every workspace manifest present to match the lockfile.
# So: give the build stage a compiler. It is discarded before the release stage,
# so the shipped image is unchanged.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN npm ci --workspace backend --include-workspace-root --omit=dev

COPY backend backend

# The shipped image keeps the API at /app rather than mirroring the monorepo, so
# that `kamal app exec 'node --import tsx bin/es.ts ...'` and the other documented
# runbook commands keep resolving relative to the working directory. `scripts` is
# here for the same reason: the corpus reparse is run that way against a deployed
# environment, and it is no use on a machine that cannot reach the database. Flatten the
# workspace tree into that layout: hoisted root modules first, backend's own
# nested overrides on top.
RUN set -eux; \
  mkdir -p /app/node_modules; \
  cp -a node_modules/. /app/node_modules/; \
  if [ -d backend/node_modules ]; then cp -a backend/node_modules/. /app/node_modules/; fi; \
  cd backend; \
  cp -a package.json tsconfig.json main.ts instrumentation.ts app config db bin lib scripts generated /app/; \
  node -e "require.resolve('tsx',{paths:['/app']})"

FROM node:24-slim AS release
WORKDIR /app
COPY --from=build /app /app
USER node
# Docker sets net.ipv4.ip_unprivileged_port_start=0, so the unprivileged `node`
# user can still bind the PORT 80 the deploy configs use.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||80)+'/up').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT []
CMD ["node", "--import", "tsx", "--import", "./instrumentation.ts", "main.ts"]
