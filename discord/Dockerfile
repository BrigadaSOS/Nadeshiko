FROM oven/bun:1 AS build
WORKDIR /app
# better-sqlite3 runs node-gyp from its install script.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

# better-sqlite3 13 prefers its bundled prebuild over node-gyp output, but the
# Linux ARM64 prebuild requires glibc 2.38 while bookworm provides glibc 2.36.
# Force a source build against the runtime image, verify it, then remove
# prebuilds so the v13 loader falls back to build/Release/better_sqlite3.node.
# This runs in its own stage so python3/make/g++ never reach the shipped image;
# devDependencies (node-gyp) are pruned once the rebuild has succeeded.
FROM node:24-slim AS native
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
RUN cd node_modules/better-sqlite3 \
  && /app/node_modules/.bin/node-gyp rebuild --release --force_build=1 \
  && test -f build/Release/better_sqlite3.node \
  && rm -rf prebuilds
RUN npm prune --omit=dev \
  && test -f node_modules/better-sqlite3/build/Release/better_sqlite3.node

FROM node:24-slim AS release
WORKDIR /app
COPY --from=native /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./
COPY --from=build /app/tsconfig.json ./
COPY docker-entrypoint.sh ./

# The bot serves /up from src/health.ts on HEALTH_PORT (3000 by default). The
# role has `proxy: false`, so this is the only liveness signal Docker gets.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||3000)+'/up').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# The entrypoint needs root to edit /etc/hosts; it drops to `node` before exec'ing.
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "--import", "tsx", "src/bot.ts"]
