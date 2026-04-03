FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

FROM base AS release
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./
COPY --from=build /app/tsconfig.json ./
COPY docker-entrypoint.sh ./

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["bun", "src/bot.ts"]
