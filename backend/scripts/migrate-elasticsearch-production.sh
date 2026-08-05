#!/usr/bin/env bash
set -euo pipefail

# Two paths, selected by what production is actually running:
#
#   already on 9.4.1  -> verify the accessory, plain `kamal deploy`, exit.
#   still on 8.19.15  -> one-time write-frozen migration onto a fresh v9 volume,
#                        then deploy. See backend/docs/elasticsearch-9-migration.md.
#
# The migration branch has not run yet: it landed after the newest release tag,
# and only a `v*` tag invokes this script. Once a tagged release has migrated
# production and the retained ES8 container has been removed (see
# scripts/cleanup-es8-rollback.sh), everything below the "already migrated"
# early exit is dead and should be deleted along with the $rollback_es plumbing.

elasticsearch_image=${1:?immutable Elasticsearch image reference is required}
backend_image=${2:?immutable backend image reference is required}
release_version=${3:?release commit SHA is required}
admin_env=${4:?admin env file is required}
remote=${REMOTE_HOST:-nadeshiko}
es=nadeshiko-backend-prod-elasticsearch
rollback_es=nadeshiko-backend-prod-elasticsearch-es8-rollback
expected_version=9.4.1
remote_lock=/var/lock/nadeshiko-elasticsearch-9-migration.lock
remote_stage=''
locked=false
frozen=false
deployment_attempted=false
previous_version=''
previous_image_id=''

case "$elasticsearch_image" in
  ghcr.io/brigadasos/nadeshiko-elasticsearch@sha256:*) ;;
  *) echo 'Elasticsearch image must be an immutable GHCR digest.' >&2; exit 1 ;;
esac
case "$backend_image" in
  ghcr.io/brigadasos/nadeshiko-backend-prod@sha256:*) ;;
  *) echo 'Backend image must be an immutable GHCR digest.' >&2; exit 1 ;;
esac
[[ "$release_version" =~ ^[0-9a-f]{40}$ ]]

verify_running_application() {
  local expected_version=$1 expected_image_id=$2
  ssh "$remote" "
    set -euo pipefail
    found=false
    while IFS= read -r container; do
      found=true
      case \"\$container\" in nadeshiko-backend-prod-web-*) ;; *) exit 1 ;; esac
      actual_image_id=\$(sudo -n docker inspect \"\$container\" --format '{{.Image}}')
      test \"\$actual_image_id\" = '$expected_image_id'
      actual_version=\$(sudo -n docker inspect \"\$container\" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^KAMAL_VERSION=' | cut -d= -f2-)
      test \"\$actual_version\" = '$expected_version'
    done < <(sudo -n docker ps --format '{{.Names}}' --filter label=service=nadeshiko-backend-prod --filter label=destination=prod --filter label=role=web)
    test \"\$found\" = true
    test \"\$(sudo -n docker inspect kamal-proxy --format '{{.State.Running}}')\" = true
  "
}

release_lock() {
  if [ "$locked" = true ]; then
    ssh "$remote" "sudo -n rmdir '$remote_lock'" >/dev/null 2>&1 || true
    locked=false
  fi
}

restore_frozen_es8_stack() {
  ssh "$remote" "
    set -euo pipefail
    if sudo -n docker inspect '$rollback_es' >/dev/null 2>&1; then
      sudo -n docker rm --force '$es' >/dev/null 2>&1 || true
      sudo -n docker rename '$rollback_es' '$es'
    fi
    sudo -n docker start '$es' >/dev/null
    while IFS= read -r container; do
      case \"\$container\" in
        nadeshiko-backend-prod-web-*) sudo -n docker start \"\$container\" >/dev/null ;;
        *) echo \"Unexpected retained application container: \$container\" >&2; exit 1 ;;
      esac
    done < '$remote_stage/app-containers'
    sudo -n docker start kamal-proxy >/dev/null
  "
}

cleanup() {
  rc=$?
  trap - EXIT

  if [ "$rc" -ne 0 ]; then
    if [ "$deployment_attempted" = true ]; then
      echo "Production deployment failed; rolling the application back explicitly to ${previous_version} while retaining the complete ES9 index." >&2
      if ! kamal rollback "$previous_version" -d prod || ! verify_running_application "$previous_version" "$previous_image_id"; then
        echo 'Application rollback or its running-container verification failed. Elasticsearch 9 remains active; traffic requires operator intervention.' >&2
      fi
    elif [ "$frozen" = true ]; then
      echo 'Elasticsearch migration failed during the write freeze; restoring the unchanged ES8 application stack.' >&2
      restore_frozen_es8_stack || echo 'Automatic ES8 stack restoration failed; operator intervention is required.' >&2
    fi
  fi

  if [ -n "$remote_stage" ]; then
    ssh "$remote" "sudo -n rm -rf '$remote_stage'" >/dev/null 2>&1 || true
  fi
  release_lock
  exit "$rc"
}
trap cleanup EXIT

read_health() {
  ssh "$remote" "sudo -n docker exec '$es' bash -c 'curl --fail --silent --user \"elastic:\$ELASTICSEARCH_ADMIN_PASSWORD\" http://localhost:9200/_cluster/health'"
}

wait_for_healthy_cluster() {
  local health=''
  for attempt in $(seq 1 90); do
    health=$(read_health 2>/dev/null || true)
    if grep -q '"timed_out":false' <<<"$health" && grep -Eq '"status":"(yellow|green)"' <<<"$health"; then
      return 0
    fi
    if [ "$attempt" -eq 90 ]; then
      ssh "$remote" "sudo -n docker logs --tail 200 '$es'"
      return 1
    fi
    sleep 2
  done
}

verify_es9() {
  local version plugins actual_image
  wait_for_healthy_cluster
  version=$(ssh "$remote" "sudo -n docker exec '$es' /usr/share/elasticsearch/bin/elasticsearch --version")
  grep -q "Version: ${expected_version}" <<<"$version"
  plugins=$(ssh "$remote" "sudo -n docker exec '$es' /usr/share/elasticsearch/bin/elasticsearch-plugin list")
  grep -qx analysis-icu <<<"$plugins"
  grep -qx analysis-sudachi <<<"$plugins"
  actual_image=$(ssh "$remote" "sudo -n docker inspect '$es' --format '{{.Config.Image}}'")
  test "$actual_image" = "$elasticsearch_image"
}

current_version=''
if ssh "$remote" "sudo -n docker inspect '$es' >/dev/null 2>&1"; then
  current_version=$(ssh "$remote" "sudo -n docker exec '$es' /usr/share/elasticsearch/bin/elasticsearch --version" || true)
fi

printf '%s' "${GITHUB_TOKEN:?GITHUB_TOKEN is required}" | \
  ssh "$remote" "sudo -n docker login ghcr.io --username '${GITHUB_ACTOR:?GITHUB_ACTOR is required}' --password-stdin >/dev/null"
ssh "$remote" "sudo -n docker pull '$backend_image' >/dev/null"
expected_backend_id=$(ssh "$remote" "sudo -n docker image inspect '$backend_image' --format '{{.Id}}'")
[[ "$expected_backend_id" =~ ^sha256:[0-9a-f]{64}$ ]]

# Future releases only verify the already-migrated accessory and deploy normally.
if grep -q "Version: ${expected_version}" <<<"$current_version"; then
  verify_es9
  VERSION="$release_version" kamal deploy -d prod --skip-push
  verify_running_application "$release_version" "$expected_backend_id"
  trap - EXIT
  echo ELASTICSEARCH_PRODUCTION_ALREADY_MIGRATED=PASS
  exit 0
fi

if ! grep -q 'Version: 8.19.15' <<<"$current_version"; then
  echo "Production Elasticsearch must be on the 8.19.15 bridge image before migrating to ${expected_version}; found: ${current_version:-<no container>}" >&2
  echo 'See backend/docs/elasticsearch-9-migration.md for the bridge image tags.' >&2
  exit 1
fi
ssh "$remote" "sudo -n mkdir '$remote_lock'"
locked=true
ssh "$remote" "! sudo -n docker inspect '$rollback_es' >/dev/null 2>&1"
ssh "$remote" "! sudo -n docker volume inspect nadeshiko-elasticsearch-v9-data >/dev/null 2>&1"
old_mounts=$(ssh "$remote" "sudo -n docker inspect '$es' --format '{{range .Mounts}}{{println .Name .Destination}}{{end}}'")
grep -qx 'nadeshiko-elasticsearch-data /usr/share/elasticsearch/data' <<<"$old_mounts"

old_web=$(ssh "$remote" "sudo -n docker ps --format '{{.Names}}' --filter name=nadeshiko-backend-prod-web | head -n1")
case "$old_web" in
  nadeshiko-backend-prod-web-*) ;;
  *) echo 'Unable to identify the running production web container.' >&2; exit 1 ;;
esac
previous_version=$(ssh "$remote" "sudo -n docker inspect '$old_web' --format '{{index .Config.Labels \"version\"}}'")
if [ -z "$previous_version" ]; then
  previous_version=${old_web#nadeshiko-backend-prod-web-}
fi
test -n "$previous_version"
previous_image_id=$(ssh "$remote" "sudo -n docker inspect '$old_web' --format '{{.Image}}'")
[[ "$previous_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]
network=$(ssh "$remote" "sudo -n docker inspect '$old_web' --format '{{range \$name, \$_ := .NetworkSettings.Networks}}{{println \$name}}{{end}}' | head -n1")
test -n "$network"
ssh "$remote" "test \"\$(sudo -n docker inspect kamal-proxy --format '{{.State.Running}}')\" = true"

remote_stage=$(ssh "$remote" "sudo -n mktemp -d /var/tmp/nadeshiko-es9-migration.XXXXXX")
ssh "$remote" "
  set -euo pipefail
  sudo -n sh -c \"docker ps --format '{{.Names}}' --filter name=nadeshiko-backend-prod-web > '$remote_stage/app-containers'\"
  test -s '$remote_stage/app-containers'
  while IFS= read -r container; do
    case \"\$container\" in nadeshiko-backend-prod-web-*) ;; *) exit 1 ;; esac
  done < '$remote_stage/app-containers'
  sudo -n sh -c \"docker inspect '$old_web' --format '{{range .Config.Env}}{{println .}}{{end}}' > '$remote_stage/app.env'\"
  sudo -n chmod 600 '$remote_stage/app.env'
"
ssh "$remote" "sudo -n tee '$remote_stage/admin.env' >/dev/null && sudo -n chmod 600 '$remote_stage/admin.env'" <"$admin_env"

# Hard maintenance window: stop ingress first, then every process that can mutate
# PostgreSQL/Elasticsearch. The old containers remain intact for rollback.
ssh "$remote" "
  set -euo pipefail
  sudo -n docker stop kamal-proxy >/dev/null
  while IFS= read -r container; do sudo -n docker stop \"\$container\" >/dev/null; done < '$remote_stage/app-containers'
"
frozen=true

ssh "$remote" "sudo -n docker stop '$es' >/dev/null; sudo -n docker rename '$es' '$rollback_es'"
ELASTICSEARCH_IMAGE="$elasticsearch_image" kamal accessory boot elasticsearch -d prod
verify_es9

ssh "$remote" "sudo -n docker run --rm --network '$network' --env-file '$remote_stage/app.env' --env-file '$remote_stage/admin.env' '$backend_image' node --import tsx bin/db.ts prepare-es"
ssh "$remote" "sudo -n docker run --rm --network '$network' --env-file '$remote_stage/app.env' --env-file '$remote_stage/admin.env' '$backend_image' node --import tsx bin/es.ts reindex --allow-prod-destructive"
status=$(ssh "$remote" "sudo -n docker run --rm --network '$network' --env-file '$remote_stage/app.env' --env-file '$remote_stage/admin.env' '$backend_image' node --import tsx bin/es.ts status" 2>&1)
grep -q 'Elasticsearch index is in sync with database segment count' <<<"$status"

analyze=$(ssh "$remote" "sudo -n docker exec '$es' bash -c 'curl --fail --silent --user \"elastic:\$ELASTICSEARCH_ADMIN_PASSWORD\" --header \"Content-Type: application/json\" --data-binary '\''{\"analyzer\":\"ja_baseform_search_analyzer\",\"text\":\"食べました\"}'\'' http://localhost:9200/nadedb_prod/_analyze'")
grep -q '"token":"食べる"' <<<"$analyze"

# Only expose the new application after the authoritative rebuild and all gates pass.
deployment_attempted=true
VERSION="$release_version" kamal deploy -d prod --skip-push
verify_running_application "$release_version" "$expected_backend_id"
deployment_attempted=false
frozen=false

ssh "$remote" "sudo -n rm -rf '$remote_stage'"
remote_stage=''
release_lock
trap - EXIT

echo "ELASTICSEARCH_PRODUCTION_MIGRATION=PASS retained_rollback_container=${rollback_es} previous_app_version=${previous_version}"
