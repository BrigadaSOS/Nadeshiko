#!/usr/bin/env bash
# Compatibility wrapper; local and CI now share run-e2e.sh.
exec "$(dirname "$0")/run-e2e.sh" "$@"
