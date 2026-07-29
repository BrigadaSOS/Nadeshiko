#!/usr/bin/env bash
set -euo pipefail

admin_env=${1:?admin env file is required}
es=nadeshiko-backend-stg-elasticsearch
web=$(sudo -n docker ps --format '{{.Names}}' --filter name=nadeshiko-backend-stg-web | head -n1)
test -n "$web"
chmod 600 "$admin_env"

for attempt in $(seq 1 90); do
  health=$(sudo -n docker exec "$es" bash -c \
    'curl --fail --silent --user "elastic:$ELASTICSEARCH_ADMIN_PASSWORD" http://localhost:9200/_cluster/health' \
    2>/dev/null || true)
  if grep -q '"timed_out":false' <<<"$health" && grep -Eq '"status":"(yellow|green)"' <<<"$health"; then
    break
  fi
  if [ "$attempt" -eq 90 ]; then
    sudo -n docker logs --tail 200 "$es"
    exit 1
  fi
  sleep 2
done

version=$(sudo -n docker exec "$es" /usr/share/elasticsearch/bin/elasticsearch --version)
grep -q 'Version: 9.4.1' <<<"$version"
plugins=$(sudo -n docker exec "$es" /usr/share/elasticsearch/bin/elasticsearch-plugin list)
grep -qx 'analysis-icu' <<<"$plugins"
grep -qx 'analysis-sudachi' <<<"$plugins"

sudo -n docker exec \
  --env-file "$admin_env" \
  --env ELASTICSEARCH_HOST=http://nadeshiko-backend-stg-elasticsearch:9200 \
  "$web" node --import tsx bin/db.ts prepare
sudo -n docker exec \
  --env ELASTICSEARCH_HOST=http://nadeshiko-backend-stg-elasticsearch:9200 \
  "$web" node --import tsx bin/es.ts reindex
status=$(sudo -n docker exec \
  --env ELASTICSEARCH_HOST=http://nadeshiko-backend-stg-elasticsearch:9200 \
  "$web" node --import tsx bin/es.ts status 2>&1)
grep -q 'Elasticsearch index is in sync with database segment count' <<<"$status"

analyze=$(sudo -n docker exec "$es" bash -c '
  curl --fail --silent --user "elastic:$ELASTICSEARCH_ADMIN_PASSWORD" \
    --header "Content-Type: application/json" \
    --data-binary '\''{"analyzer":"ja_baseform_search_analyzer","text":"食べました"}'\'' \
    http://localhost:9200/nadedb_dev/_analyze
')
grep -q '"token":"食べる"' <<<"$analyze"

echo ELASTICSEARCH_STAGING_CANARY_BOOTSTRAP=PASS
