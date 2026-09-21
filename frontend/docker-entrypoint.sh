#!/bin/sh
# The deploy config maps the environment's API hostname to Docker's stable host
# gateway. Do not resolve kamal-proxy here: its container address changes when
# the proxy is replaced, while this frontend keeps running.
#
# The image starts as root only to make the uid/gid transition deterministic;
# the Nitro server itself runs as `node`.
if [ "$(id -u)" = 0 ]; then
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
