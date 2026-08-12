# Build from the repository root, not from frontend/: npm workspaces resolve the
# app's dependencies (including the vendored @brigadasos/nadeshiko-sdk, whose
# TypeScript sources Nuxt compiles into the bundle) against the root
# package.json and package-lock.json.
#
#   docker build -f frontend/Dockerfile .
FROM node:24-slim AS deps
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
# `npm ci` reconciles the whole workspace set against the root lockfile, so every
# workspace manifest has to be present even though only `frontend` is installed.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY discord/package.json discord/
COPY packages/nadeshiko-sdk/package.json packages/nadeshiko-sdk/
# Warm npm's cache from the lockfile alone, so the download cost stays in a
# layer that source edits do not invalidate.
RUN npm ci --workspace frontend --include-workspace-root --ignore-scripts \
  && rm -rf node_modules frontend/node_modules

FROM deps AS build
COPY frontend frontend
COPY packages/nadeshiko-sdk packages/nadeshiko-sdk
# Install from the lockfile, skipping lifecycle scripts: the frontend's
# postinstall is `nuxt prepare`, which npm runs before the tree is complete.
# `nuxt build` re-runs the same preparation, so nothing is lost.
RUN npm ci --ignore-scripts

# Nuxt's toolchain (oxc-parser, oxc-transform, ...) loads compiled binaries from
# platform-specific optional packages that `npm ci` cannot install on Linux from
# a macOS-generated lockfile. See the script for the full explanation.
COPY scripts/install-linux-native-bindings.mjs scripts/
RUN node scripts/install-linux-native-bindings.mjs

# The API reference served at /docs/api is generated from the committed OpenAPI
# spec, here, rather than being whatever a developer last built locally.
# `frontend/public/docs/api/` is gitignored, but Docker's build context ignores
# .gitignore -- so before this step the `COPY frontend frontend` above shipped a
# stale local copy on a developer's machine and nothing at all on a clean CI
# builder. Redocly needs the backend's docs/ and its config, and it runs from
# backend/ so the relative paths in redocly.yaml resolve.
COPY backend/package.json backend/
COPY backend/redocly.yaml backend/
COPY backend/docs backend/docs
RUN npm run docs:build --workspace backend

ARG NUXT_PUBLIC_ENVIRONMENT
ARG NITRO_PRESET=node-server
ENV NUXT_PUBLIC_ENVIRONMENT=${NUXT_PUBLIC_ENVIRONMENT}
ENV NITRO_PRESET=${NITRO_PRESET}
RUN npm run build --workspace frontend

# Nitro bundles the app's own dependencies into .output, but the OpenTelemetry
# SDK is loaded through --import before the bundle and so has to ship separately.
FROM node:24-slim AS otel-deps
WORKDIR /deps
RUN npm init -y >/dev/null \
  && npm install --omit=dev --no-audit --no-fund \
    @opentelemetry/sdk-node \
    @opentelemetry/sdk-trace-node \
    @opentelemetry/exporter-trace-otlp-http \
    @opentelemetry/exporter-metrics-otlp-http \
    @opentelemetry/resources \
    @opentelemetry/sdk-metrics \
    @opentelemetry/instrumentation-http \
    @opentelemetry/instrumentation-undici \
    @opentelemetry/instrumentation-runtime-node \
    @opentelemetry/instrumentation-pino

FROM node:24-slim
WORKDIR /app
COPY --from=build /build/frontend/.output ./.output
RUN rm -rf .output/server/node_modules/@opentelemetry/api
COPY --from=otel-deps /deps/node_modules ./node_modules
COPY frontend/instrumentation.mjs frontend/route-normalization.mjs ./
COPY frontend/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENV HOST=0.0.0.0
ENV PORT=3000

# HEAP CAP, SET EXPLICITLY BECAUSE THE DEFAULT IS DERIVED AND THIS SERVICE HAS
# ALREADY DIED OF IT ONCE (#484: `FATAL ERROR: JavaScript heap out of memory`
# during a JST-morning spike). Node sizes the old space from the memory it can
# see, so the cap silently tracks whatever the container is given that week --
# fine until the container limit moves and nobody re-derives the heap.
#
# 1024 MiB inside the 1.5g cap set in `config/deploy.prod.yml`, NOT the 1536 an
# earlier draft proposed: 1536 would let the JS heap alone claim the entire
# container, leaving nothing for the things that are not the heap -- native
# allocations, the OTel batch processor, Pino's buffers, sharp -- and the kernel
# would kill the container instead of V8 running a GC. The ~500 MiB of headroom
# is the point. Measured working set was 600-900 MiB peaking at 906.
#
# Raise BOTH numbers together, or neither.
ENV NODE_OPTIONS=--max-old-space-size=1024
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/up').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# The entrypoint needs root to edit /etc/hosts; it drops to `node` before exec'ing.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--import", "./instrumentation.mjs", ".output/server/index.mjs"]
