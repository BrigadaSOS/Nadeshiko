#!/usr/bin/env bash
set -euo pipefail

# Remove the Elasticsearch 8 rollback container and its data volume, retained by
# scripts/migrate-elasticsearch-production.sh through the post-migration
# observation window.
#
# This is destructive and irreversible: the ES8 index cannot be recovered
# afterwards. It does not need to be — the index is derived data whose
# authoritative source is PostgreSQL, and a rebuild is `bin/es.ts reindex`. What
# you actually give up is the fast path back to ES8 if ES9 turns out to be bad.
#
# Run it only once the observation window has closed: ES9 serving production
# traffic, E2E green, search telemetry reviewed.
#
# Usage:
#   backend/scripts/cleanup-es8-rollback.sh [--dry-run] [--yes]
#
#   --dry-run  report what would be removed and exit without changing anything
#   --yes      skip the interactive confirmation (for a deliberate scripted run)

remote=${REMOTE_HOST:-nadeshiko}
rollback_es=nadeshiko-backend-prod-elasticsearch-es8-rollback
rollback_volume=nadeshiko-elasticsearch-data
live_es=nadeshiko-backend-prod-elasticsearch
expected_version=9.4.1

dry_run=false
assume_yes=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    --yes) assume_yes=true ;;
    -h|--help) sed -n '3,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "error: unknown argument '$arg'" >&2; exit 1 ;;
  esac
done

remote_docker() {
  ssh "$remote" "sudo -n docker $*"
}

echo "→ Checking the live Elasticsearch accessory on ${remote}"
if ! remote_docker "inspect '$live_es' >/dev/null 2>&1"; then
  echo "error: '$live_es' does not exist on ${remote}; refusing to remove the rollback stack" >&2
  exit 1
fi

if [ "$(remote_docker "inspect '$live_es' --format '{{.State.Running}}'")" != true ]; then
  echo "error: '$live_es' is not running; bring production Elasticsearch back up first" >&2
  exit 1
fi

live_version=$(remote_docker "exec '$live_es' /usr/share/elasticsearch/bin/elasticsearch --version")
if ! grep -q "Version: ${expected_version}" <<<"$live_version"; then
  echo "error: live Elasticsearch is not ${expected_version} (got: ${live_version})" >&2
  echo "The migration has not completed, so the ES8 rollback stack is still the way back." >&2
  exit 1
fi

health=$(remote_docker "exec '$live_es' bash -c 'curl --fail --silent --user \"elastic:\$ELASTICSEARCH_ADMIN_PASSWORD\" http://localhost:9200/_cluster/health'")
if ! grep -q '"timed_out":false' <<<"$health" || ! grep -Eq '"status":"(yellow|green)"' <<<"$health"; then
  echo "error: live Elasticsearch cluster is not healthy; not removing the rollback stack" >&2
  echo "$health" >&2
  exit 1
fi
echo "  ${expected_version} is live and healthy."

container_present=false
volume_present=false
remote_docker "inspect '$rollback_es' >/dev/null 2>&1" && container_present=true
remote_docker "volume inspect '$rollback_volume' >/dev/null 2>&1" && volume_present=true

if [ "$container_present" = false ] && [ "$volume_present" = false ]; then
  echo "Nothing to do: neither '$rollback_es' nor volume '$rollback_volume' exists."
  exit 0
fi

# A stopped container still holds a reference to the volume, so removing the
# volume while it exists would fail. Report both, remove in that order.
echo
echo "Would remove from ${remote}:"
if [ "$container_present" = true ]; then
  state=$(remote_docker "inspect '$rollback_es' --format '{{.State.Status}}'")
  if [ "$state" = running ]; then
    echo "error: '$rollback_es' is running; something is using the old stack. Investigate before removing." >&2
    exit 1
  fi
  echo "  container  $rollback_es (${state})"
fi
if [ "$volume_present" = true ]; then
  size=$(remote_docker "system df -v --format '{{range .Volumes}}{{if eq .Name \"$rollback_volume\"}}{{.Size}}{{end}}{{end}}'" || true)
  echo "  volume     $rollback_volume${size:+ (${size})}"
fi

if [ "$dry_run" = true ]; then
  echo
  echo "--dry-run: nothing was changed."
  exit 0
fi

if [ "$assume_yes" != true ]; then
  echo
  echo "This cannot be undone. Type the host name to confirm:"
  read -r -p "  confirm host [${remote}]: " confirmation
  if [ "$confirmation" != "$remote" ]; then
    echo "Aborted: confirmation did not match '${remote}'." >&2
    exit 1
  fi
fi

if [ "$container_present" = true ]; then
  echo "→ Removing container ${rollback_es}"
  remote_docker "rm '$rollback_es'"
fi
if [ "$volume_present" = true ]; then
  echo "→ Removing volume ${rollback_volume}"
  remote_docker "volume rm '$rollback_volume'"
fi

echo
echo "Done. The ES8 rollback stack is gone; recovery is now a reindex from PostgreSQL."
echo "The 8→9 branch of scripts/migrate-elasticsearch-production.sh can be deleted."
