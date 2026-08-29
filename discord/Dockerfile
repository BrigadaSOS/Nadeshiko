# Build from the repository root, not from discord/: npm workspaces resolve the
# bot's dependencies (including the vendored @brigadasos/nadeshiko-sdk) against
# the root package.json and package-lock.json.
#
#   docker build -f discord/Dockerfile .
FROM node:24-slim AS manifests
WORKDIR /build
# better-sqlite3 runs node-gyp from its install script. The toolchain is confined
# to the build stages; the release image copies only the assembled /app.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# `npm ci` reconciles the whole workspace set against the root lockfile, so every
# workspace manifest has to be present even though only `discord` is installed.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY discord/package.json discord/
COPY packages/nadeshiko-sdk/package.json packages/nadeshiko-sdk/
COPY packages/nadeshiko-shared/package.json packages/nadeshiko-shared/

# better-sqlite3 13 prefers its bundled prebuild over node-gyp output, but the
# Linux ARM64 prebuild requires glibc 2.38 while bookworm provides glibc 2.36, so
# the binding has to be compiled here. node-gyp is a devDependency and needs a
# C++ toolchain, none of which may reach the shipped image — hence a throwaway
# stage that exports nothing but the compiled binding.
FROM manifests AS native
RUN npm ci --workspace discord --include-workspace-root
# ASK NODE WHERE THE PACKAGE IS rather than assuming `discord/node_modules`.
# npm hoists to the root whenever nothing conflicts, so the directory this used
# to hardcode exists only while some other workspace disagrees about the version.
# On 2026-08-12 frontend's `db0` and discord landed on the same better-sqlite3,
# npm deduplicated them to /build/node_modules, and the `cd` below failed --
# breaking every discord deploy, on a bump that had nothing to do with the bot.
# `--force_build=1` is what makes binding.gyp compile, instead of stamping a
# placeholder next to the prebuild it would otherwise expect to be used.
RUN BS3="$(node -p "require('path').dirname(require.resolve('better-sqlite3/package.json', { paths: ['/build/discord'] }))")" \
  && NODE_GYP="$(node -p "require.resolve('node-gyp/bin/node-gyp.js', { paths: ['/build/discord'] })")" \
  && cd "$BS3" \
  && node "$NODE_GYP" rebuild --release --force_build=1 \
  && test -f build/Release/better_sqlite3.node \
  && mkdir -p /native \
  && cp build/Release/better_sqlite3.node /native/

FROM manifests AS build
# A second, separate install: `npm prune --omit=dev` leaves parts of the dev tree
# behind under workspaces, while installing with --omit=dev from scratch does not.
RUN npm ci --workspace discord --include-workspace-root --omit=dev
# Drop the unusable prebuilds so better-sqlite3's v13 loader falls back to
# build/Release/better_sqlite3.node, then graft on the binding compiled above.
#
# Staged through /native because `COPY --from` takes a literal path and cannot
# ask node anything; the shell steps either side are what tolerate the package
# being hoisted. The `rm -rf` was already placement-proof by accident -- it
# silently succeeded on a path that no longer existed, which is exactly why the
# failure surfaced one step later in the `native` stage instead of here.
COPY --from=native /native/better_sqlite3.node /native/better_sqlite3.node
RUN BS3="$(node -p "require('path').dirname(require.resolve('better-sqlite3/package.json', { paths: ['/build/discord'] }))")" \
  && rm -rf "$BS3/prebuilds" \
  && mkdir -p "$BS3/build/Release" \
  && cp /native/better_sqlite3.node "$BS3/build/Release/better_sqlite3.node" \
  && rm -rf /native

COPY discord discord
COPY packages/nadeshiko-sdk packages/nadeshiko-sdk

# The shipped image keeps the bot at /app rather than mirroring the monorepo: the
# `nadeshiko-discord-data` volume mounts at /app/data and src/settings.ts opens
# `data/settings.db` relative to the working directory. Flatten the workspace
# tree into that layout — hoisted root modules, discord's own nested overrides on
# top, and the vendored SDK materialized over its workspace symlink, which would
# otherwise dangle once packages/ is gone.
RUN set -eux; \
  mkdir -p /app/node_modules/@brigadasos; \
  cp -a node_modules/. /app/node_modules/; \
  if [ -d discord/node_modules ]; then cp -a discord/node_modules/. /app/node_modules/; fi; \
  rm -rf /app/node_modules/@brigadasos/nadeshiko-sdk; \
  cp -a packages/nadeshiko-sdk /app/node_modules/@brigadasos/nadeshiko-sdk; \
  cp -a discord/src discord/package.json discord/tsconfig.json discord/docker-entrypoint.sh /app/; \
  chmod +x /app/docker-entrypoint.sh; \
  node -e "require.resolve('better-sqlite3',{paths:['/app']})"; \
  test -f /app/node_modules/better-sqlite3/build/Release/better_sqlite3.node

FROM node:24-slim AS release
WORKDIR /app
COPY --from=build /app /app

# The bot serves /up from src/health.ts on HEALTH_PORT (3000 by default). The
# role has `proxy: false`, so this is the only liveness signal Docker gets.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||3000)+'/up').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# The entrypoint needs root to edit /etc/hosts; it drops to `node` before exec'ing.
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "--import", "tsx", "src/bot.ts"]
