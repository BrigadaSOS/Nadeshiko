FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NUXT_PUBLIC_ENVIRONMENT
ARG NITRO_PRESET=node-server
ENV NUXT_PUBLIC_ENVIRONMENT=${NUXT_PUBLIC_ENVIRONMENT}
ENV NITRO_PRESET=${NITRO_PRESET}
RUN npx nuxt build

FROM oven/bun:1 AS otel-deps
WORKDIR /deps
RUN bun init -y && bun add @opentelemetry/sdk-node @opentelemetry/sdk-trace-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http @opentelemetry/resources @opentelemetry/sdk-metrics @opentelemetry/instrumentation-http @opentelemetry/instrumentation-undici @opentelemetry/instrumentation-runtime-node @opentelemetry/instrumentation-pino

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/.output ./.output
RUN rm -rf .output/server/node_modules/@opentelemetry/api
COPY --from=otel-deps /deps/node_modules ./node_modules
COPY instrumentation.mjs route-normalization.mjs ./
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--import", "./instrumentation.mjs", ".output/server/index.mjs"]
