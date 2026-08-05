FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock ./
# The image runs TypeScript directly through tsx, which is a regular dependency,
# so --production keeps everything the runtime needs. Nothing under app/, config/,
# db/, lib/ or generated/ imports a devDependency; the bin/ scripts that do
# (generateBrunoCollection, generateErrorProfiles, ...) are code generators that
# only ever run in dev and CI, never in a deployed container.
RUN bun install --frozen-lockfile --production

FROM node:22-slim AS release
WORKDIR /app
COPY --from=install /app/node_modules ./node_modules
COPY package.json tsconfig.json main.ts instrumentation.ts ./
COPY app ./app
COPY config ./config
COPY db ./db
COPY bin ./bin
COPY lib ./lib
COPY generated ./generated
USER node
# Docker sets net.ipv4.ip_unprivileged_port_start=0, so the unprivileged `node`
# user can still bind the PORT 80 the deploy configs use.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||80)+'/up').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT []
CMD ["node", "--import", "tsx", "--import", "./instrumentation.ts", "main.ts"]
