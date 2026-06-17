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
# Rebuild better-sqlite3 native binding against this image's glibc (2.36 on
# bookworm). The prebuilt .node binary ships from a glibc 2.38 build host and
# fails to load in the release image with "GLIBC_2.38 not found".
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
RUN npm rebuild better-sqlite3 --build-from-source
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./
COPY --from=build /app/tsconfig.json ./
COPY docker-entrypoint.sh ./

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "--import", "tsx", "src/bot.ts"]
