FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun build ./main.ts --outdir ./prod --target bun --sourcemap=linked
RUN bun build ./instrumentation.ts --outdir ./prod --target bun --entrypoint-name=instrumentation

FROM oven/bun:1 AS toolbox
RUN apt-get update && apt-get install -y --no-install-recommends unzip ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/bin ./bin
COPY --from=build /app/app ./app
COPY --from=build /app/config ./config
COPY --from=build /app/db ./db
COPY --from=build /app/lib ./lib
COPY --from=build /app/generated ./generated
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
ENTRYPOINT []
CMD ["sleep", "infinity"]

FROM oven/bun:1 AS release
WORKDIR /app
COPY --from=build /app/prod ./prod
COPY --from=build /app/app/mailers/templates ./app/mailers/templates
ENTRYPOINT []
CMD ["bun", "--preload", "./prod/instrumentation.js", "./prod/main.js"]
