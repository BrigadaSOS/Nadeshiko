#!/bin/sh
# The deploy config maps the environment's API hostname to Docker's stable host
# gateway. Do not resolve kamal-proxy here: its container address changes when
# the proxy is replaced, while this frontend keeps running.
#
# The image starts as root only to make the uid/gid transition deterministic;
# the Nitro server itself runs as `node`.
if [ "$(id -u)" = 0 ]; then
  # Docker creates a new bind mount as root on its first use.
  if [ -n "${NUXT_SITEMAP_SNAPSHOT_DIR:-}" ]; then
    mkdir -p "$NUXT_SITEMAP_SNAPSHOT_DIR"
    chown node:node "$NUXT_SITEMAP_SNAPSHOT_DIR"
  fi
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
