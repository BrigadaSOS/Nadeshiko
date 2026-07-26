FROM oven/bun:1 AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

FROM node:24-slim AS release
WORKDIR /app
# better-sqlite3 13 prefers its bundled prebuild over node-gyp output, but the
# Linux ARM64 prebuild requires glibc 2.38 while bookworm provides glibc 2.36.
# Force a source build against this image, verify it, then remove prebuilds so
# the v13 loader falls back to build/Release/better_sqlite3.node.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
RUN cd node_modules/better-sqlite3 \
  && /app/node_modules/.bin/node-gyp rebuild --release --force_build=1 \
  && test -f build/Release/better_sqlite3.node \
  && rm -rf prebuilds
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./
COPY --from=build /app/tsconfig.json ./
COPY docker-entrypoint.sh ./

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "--import", "tsx", "src/bot.ts"]
