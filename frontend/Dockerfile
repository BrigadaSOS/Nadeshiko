FROM oven/bun:1 AS build
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ARG NUXT_PUBLIC_ENVIRONMENT
ENV NUXT_PUBLIC_ENVIRONMENT=${NUXT_PUBLIC_ENVIRONMENT}
ARG SENTRY_ORG
ARG SENTRY_PROJECT
RUN --mount=type=secret,id=SENTRY_FRONTEND_DSN \
    --mount=type=secret,id=SENTRY_AUTH_TOKEN \
    SENTRY_FRONTEND_DSN="$(cat /run/secrets/SENTRY_FRONTEND_DSN 2>/dev/null)" \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/SENTRY_AUTH_TOKEN 2>/dev/null)" \
    bun run build

FROM oven/bun:1 AS otel-deps
WORKDIR /deps
RUN bun init -y && bun add @opentelemetry/sdk-node @opentelemetry/sdk-trace-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http @opentelemetry/resources @opentelemetry/sdk-metrics @opentelemetry/instrumentation-http @opentelemetry/instrumentation-undici

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/.output ./.output
RUN rm -rf .output/server/node_modules/@opentelemetry/api
COPY --from=otel-deps /deps/node_modules ./node_modules
COPY instrumentation.mjs ./
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--import", "./instrumentation.mjs", ".output/server/index.mjs"]
