#!/bin/sh
# Route backend traffic through kamal-proxy internally instead of public internet.
# Resolves kamal-proxy's IP and maps backend hostnames to it in /etc/hosts.
IP=$(getent hosts kamal-proxy 2>/dev/null | awk '{print $1}')
if [ -n "$IP" ]; then
  echo "$IP api-dev.nadeshiko.co api.nadeshiko.co" >> /etc/hosts
fi
exec "$@"
