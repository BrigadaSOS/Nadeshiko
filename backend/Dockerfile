FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun build ./main.ts --outdir ./prod --target bun --sourcemap=linked
RUN --mount=type=secret,id=SENTRY_AUTH_TOKEN \
    export SENTRY_AUTH_TOKEN="$(cat /run/secrets/SENTRY_AUTH_TOKEN 2>/dev/null)" && \
    ./node_modules/.bin/sentry-cli sourcemaps inject ./prod && \
    ./node_modules/.bin/sentry-cli sourcemaps upload \
      --org david-afonso \
      --project nadeshiko-backend \
      ./prod && \
    rm -f ./prod/*.map

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

ENTRYPOINT []
CMD ["bun", "run", "start"]
