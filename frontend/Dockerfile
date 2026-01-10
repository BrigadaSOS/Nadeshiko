FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1
WORKDIR /app
COPY --from=build /app/.output ./.output
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

CMD ["bun", ".output/server/index.mjs"]
