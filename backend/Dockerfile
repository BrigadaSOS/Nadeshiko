FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun build ./main.ts --outdir ./prod --target bun

FROM oven/bun:1 AS release
WORKDIR /app
COPY --from=build /app/prod ./prod
COPY --from=build /app/bin ./bin
COPY --from=build /app/app ./app
COPY --from=build /app/config ./config
COPY --from=build /app/db ./db
COPY --from=build /app/lib ./lib
COPY --from=build /app/generated ./generated
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

ENV NEW_RELIC_NO_CONFIG_FILE=true
ENV NEW_RELIC_LOG=stdout

CMD ["bun", "run", "start"]
