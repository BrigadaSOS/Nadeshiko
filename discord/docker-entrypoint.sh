#!/bin/sh
# Route backend traffic through kamal-proxy internally instead of public internet.
# Resolves kamal-proxy's IP and maps backend hostnames to it in /etc/hosts.
IP=$(getent hosts kamal-proxy 2>/dev/null | awk '{print $1}')
if [ -n "$IP" ]; then
  echo "$IP api.nadeshiko.co" >> /etc/hosts
fi

# Editing /etc/hosts needs root, so the container starts privileged and the bot
# itself runs as `node`. The settings database lives on a named volume created
# before this switch, so take ownership of it on the way down.
if [ "$(id -u)" = 0 ]; then
  mkdir -p /app/data
  chown -R node:node /app/data
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
