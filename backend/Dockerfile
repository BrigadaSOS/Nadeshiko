FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS toolbox
RUN apt-get update && apt-get install -y --no-install-recommends unzip ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=install /app/node_modules ./node_modules
COPY bin ./bin
COPY app ./app
COPY config ./config
COPY db ./db
COPY lib ./lib
COPY generated ./generated
COPY scripts ./scripts
COPY tsconfig.json ./tsconfig.json
COPY package.json bun.lock ./
ENTRYPOINT []
CMD ["sleep", "infinity"]

FROM node:22-slim AS release
WORKDIR /app
COPY --from=install /app/node_modules ./node_modules
COPY package.json tsconfig.json main.ts instrumentation.ts ./
COPY app ./app
COPY config ./config
COPY db ./db
COPY lib ./lib
COPY generated ./generated
ENTRYPOINT []
CMD ["node", "--import", "tsx", "--import", "./instrumentation.ts", "main.ts"]
