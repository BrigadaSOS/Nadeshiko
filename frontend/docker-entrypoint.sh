#!/bin/sh
# Route backend traffic through kamal-proxy internally instead of public internet.
# Resolves kamal-proxy's IP and maps backend hostnames to it in /etc/hosts.
IP=$(getent hosts kamal-proxy 2>/dev/null | awk '{print $1}')
if [ -n "$IP" ]; then
  echo "$IP api-stg.nadeshiko.co api.nadeshiko.co" >> /etc/hosts
fi

# Editing /etc/hosts needs root, so the container starts privileged and the Nitro
# server itself runs as `node`.
if [ "$(id -u)" = 0 ]; then
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
