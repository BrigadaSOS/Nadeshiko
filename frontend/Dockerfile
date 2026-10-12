# syntax=docker/dockerfile:1

# Build from the repository root for workspace manifests, lockfile and SDK sources:
#   docker build -f frontend/Dockerfile .
FROM node:24-slim AS deps
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
# npm ci needs every workspace manifest to reconcile the root lockfile.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY discord/package.json discord/
COPY packages/nadeshiko-sdk/package.json packages/nadeshiko-sdk/
COPY packages/nadeshiko-shared/package.json packages/nadeshiko-shared/
# Warm the dependency cache in a layer that source edits do not invalidate.
RUN npm ci --workspace frontend --include-workspace-root --ignore-scripts \
  && rm -rf node_modules frontend/node_modules

FROM deps AS build
COPY frontend frontend
COPY packages/nadeshiko-sdk packages/nadeshiko-sdk
COPY packages/nadeshiko-shared packages/nadeshiko-shared
# Skip lifecycle scripts: nuxt prepare needs the complete tree; nuxt build prepares it.
RUN npm ci --ignore-scripts

# Install Linux optional native bindings missing from a macOS-generated lockfile;
# see install-linux-native-bindings.mjs for the workaround.
COPY scripts/install-linux-native-bindings.mjs scripts/
RUN node scripts/install-linux-native-bindings.mjs

# Generate /docs/api from committed specs, not gitignored local build output.
# Docker ignores .gitignore; .dockerignore excludes that stale output. Redocly runs
# from backend/ for relative paths, and docs:build copies the spec's ./logo.png.
COPY backend/package.json backend/
COPY backend/redocly.yaml backend/
COPY backend/docs backend/docs
RUN npm run docs:build --workspace backend

ARG NUXT_PUBLIC_ENVIRONMENT
ARG NITRO_PRESET=node-server
ENV NUXT_PUBLIC_ENVIRONMENT=${NUXT_PUBLIC_ENVIRONMENT}
ENV NITRO_PRESET=${NITRO_PRESET}
# Production source-map upload uses a BuildKit secret for this instruction only;
# never persist the key in ARG, ENV, layers or the final image. Staging skips upload,
# so the mount is optional; project ID and host are set in nuxt.config.ts.
RUN --mount=type=secret,id=posthog_cli_api_key \
  if [ -f /run/secrets/posthog_cli_api_key ]; then \
    export POSTHOG_CLI_API_KEY="$(cat /run/secrets/posthog_cli_api_key)"; \
  fi; \
  npm run build --workspace frontend

# Verify final asset bytes against HTML SRI hashes: PostHog's chunk-ID injection
# once rewrote assets after hashing, breaking production despite a healthy /up.
# Staging skips that upload, so this must fail the image build in every environment.
RUN cd frontend && npm run verify:sri
# Production-only sitemap check: two workers, fixture backend and process replacement.
RUN if [ "$NUXT_PUBLIC_ENVIRONMENT" = "production" ]; then \
    cd frontend && node scripts/verify-sitemap-snapshot.mjs; \
  fi

# --import loads OpenTelemetry before Nitro's bundle, so ship its SDK separately.
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
COPY frontend/scripts/warm-sitemaps.mjs ./warm-sitemaps.mjs
COPY frontend/scripts/publish-sitemaps.mjs ./publish-sitemaps.mjs
COPY frontend/scripts/verify-runtime.mjs ./verify-runtime.mjs
COPY frontend/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENV HOST=0.0.0.0
ENV PORT=3000

# Explicit old-space cap avoids implicit V8 sizing (#484). This is not a total-heap
# or RSS cap: 1024MiB measured 1216MiB heap_size_limit in this image; allow headroom
# for young heaps, native allocations and telemetry. Production overrides this
# wholesale with 640MiB per process for two workers inside 2GiB; coordinate heap,
# worker count and deployment memory limits when changing them.
ENV NODE_OPTIONS=--max-old-space-size=1024
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/up').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# Start as root to prepare sitemap snapshot ownership, then run Nitro as node.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--import", "./instrumentation.mjs", ".output/server/index.mjs"]
