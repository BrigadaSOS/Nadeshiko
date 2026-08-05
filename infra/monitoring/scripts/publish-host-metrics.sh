#!/usr/bin/env bash
set -uo pipefail

# Publish the handful of host-side facts that nothing else exports:
# Elasticsearch cluster health, Postgres backup freshness, and container restart
# counts. Runs on the `nadeshiko` host from cron and pushes straight into
# VictoriaMetrics over Tailscale.
#
# Why a script and not exporters: three exporters (elasticsearch_exporter,
# postgres_exporter, cAdvisor) plus scrape-config changes on the monitoring host,
# for six numbers, on a box already at 3.5GB for Elasticsearch alone. This reads
# the same facts from the containers that are already running.
#
# Install (see infra/monitoring/README.md for the full walkthrough):
#
#   sudo install -m 0755 publish-host-metrics.sh /usr/local/bin/
#   sudo crontab -e
#   */5 * * * * /usr/local/bin/publish-host-metrics.sh >> /var/log/nadeshiko-host-metrics.log 2>&1
#
# Deliberately NOT `set -e`: a partial publish beats no publish. Each probe
# failing sets its own metric to a failure value, and the run still ships
# whatever it did learn. The one thing that must not be faked is
# nadeshiko_host_metrics_last_success_timestamp_seconds, which is only emitted
# when the push itself succeeds.

VM_ENDPOINT="${VM_ENDPOINT:-http://monitoring:8428/api/v1/import/prometheus}"
ENVIRONMENT="${ENVIRONMENT:-prod}"
ES_CONTAINER="${ES_CONTAINER:-nadeshiko-backend-prod-elasticsearch}"
BACKUP_CONTAINER="${BACKUP_CONTAINER:-nadeshiko-backend-prod-pg-backup}"
# Containers whose restart counts are worth watching. Kamal's app containers are
# versioned (nadeshiko-backend-prod-web-<sha>) so they are matched by prefix below.
WATCH_PREFIXES="${WATCH_PREFIXES:-nadeshiko-backend-prod nadeshiko-frontend-prod nadeshiko-discord-prod kamal-proxy}"

payload=""
emit() {
  payload+="$1"$'\n'
}

# --- Elasticsearch ----------------------------------------------------------
# Reads the admin password out of the container's own environment, so no
# credential is stored on the host for this script's benefit.
es_up=0
es_status=3   # 0 green, 1 yellow, 2 red, 3 unknown/unreachable
health=$(docker exec "$ES_CONTAINER" bash -c \
  'curl --fail --silent --max-time 10 --user "elastic:$ELASTICSEARCH_ADMIN_PASSWORD" http://localhost:9200/_cluster/health' 2>/dev/null)
if [ -n "$health" ]; then
  case "$health" in
    *'"status":"green"'*)  es_up=1; es_status=0 ;;
    *'"status":"yellow"'*) es_up=1; es_status=1 ;;
    *'"status":"red"'*)    es_up=1; es_status=2 ;;
  esac
fi
emit "nadeshiko_elasticsearch_up{environment=\"${ENVIRONMENT}\"} ${es_up}"
emit "nadeshiko_elasticsearch_cluster_status{environment=\"${ENVIRONMENT}\"} ${es_status}"

# --- Postgres backup freshness ---------------------------------------------
# The kartoza accessory already holds the R2 credentials and an s3cmd config, so
# ask it rather than duplicating either. Its listing is
#   <YYYY-MM-DD> <HH:MM> <size> s3://<bucket>/<YYYY>/<Month>/PG_<db>.<DD-Month-YYYY>.dmp.gz
# and the date/time prefix sorts chronologically, so the last line is the newest
# object. Reading the object timestamp (not the name) means a backup that ran but
# uploaded nothing cannot look fresh.
newest=$(docker exec "$BACKUP_CONTAINER" bash -c \
  's3cmd ls -r "s3://$BUCKET/" 2>/dev/null | grep -E "\.dmp(\.gz)?$" | sort | tail -n1' 2>/dev/null)
if [ -n "$newest" ]; then
  backup_date=$(awk '{print $1}' <<<"$newest")
  backup_time=$(awk '{print $2}' <<<"$newest")
  backup_epoch=$(date -u -d "${backup_date} ${backup_time}" +%s 2>/dev/null)
  if [ -n "${backup_epoch:-}" ]; then
    emit "nadeshiko_postgres_backup_last_success_timestamp_seconds{environment=\"${ENVIRONMENT}\"} ${backup_epoch}"
  else
    echo "warning: could not parse backup timestamp from: ${newest}" >&2
  fi
else
  # Emitting nothing is correct here: a zero would read as "backed up in 1970"
  # and fire the staleness alert with a misleading age, while absence lets
  # NadeshikoPostgresBackupStale stay quiet and NadeshikoHostMetricsMissing
  # stay the signal for "this script cannot see anything".
  echo "warning: no backup objects listed via ${BACKUP_CONTAINER}" >&2
fi

# --- Container restart counts ----------------------------------------------
# RestartCount is Docker's own counter for restart-policy restarts. A deploy
# creates a brand new container starting at zero, so this never counts deploys.
while IFS= read -r container; do
  [ -n "$container" ] || continue
  for prefix in $WATCH_PREFIXES; do
    case "$container" in
      "$prefix"*)
        count=$(docker inspect "$container" --format '{{.RestartCount}}' 2>/dev/null)
        [ -n "$count" ] && emit "nadeshiko_container_restart_count{container=\"${container}\"} ${count}"
        break
        ;;
    esac
  done
done < <(docker ps --format '{{.Names}}' 2>/dev/null)

# --- Publish ----------------------------------------------------------------
if [ -z "$payload" ]; then
  echo "error: nothing to publish" >&2
  exit 1
fi

if ! printf '%s' "$payload" | curl --fail --silent --show-error --max-time 20 \
  --data-binary @- "$VM_ENDPOINT"; then
  echo "error: push to ${VM_ENDPOINT} failed" >&2
  exit 1
fi

# Only now, with the push confirmed, claim success. Alerting on the age of this
# metric is what turns "the publisher died" from invisible into a warning.
printf 'nadeshiko_host_metrics_last_success_timestamp_seconds %s\n' "$(date -u +%s)" |
  curl --fail --silent --show-error --max-time 20 --data-binary @- "$VM_ENDPOINT"
