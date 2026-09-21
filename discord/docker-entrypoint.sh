#!/bin/sh
# The deploy config maps the API hostname to Docker's stable host gateway. Do
# not resolve kamal-proxy here: its container address changes when the proxy is
# replaced, while this bot keeps running.
#
# The settings database lives on a named volume created before the uid switch,
# so the container starts as root only to take ownership of it on the way down.
if [ "$(id -u)" = 0 ]; then
  mkdir -p /app/data
  chown -R node:node /app/data
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
