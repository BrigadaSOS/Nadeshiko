#!/bin/sh
# API hostnames use Docker's stable host gateway from deploy config, not the
# replaceable kamal-proxy container IP. Start as root to prepare sitemap snapshots,
# then drop to node before running Nitro.
if [ "$(id -u)" = 0 ]; then
  # First-use bind mounts may be root-owned; make sitemap snapshots writable by node.
  if [ -n "${NUXT_SITEMAP_SNAPSHOT_DIR:-}" ]; then
    mkdir -p "$NUXT_SITEMAP_SNAPSHOT_DIR"
    chown node:node "$NUXT_SITEMAP_SNAPSHOT_DIR"
  fi
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
