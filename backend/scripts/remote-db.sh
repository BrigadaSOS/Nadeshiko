#!/usr/bin/env bash
set -euo pipefail

# Run a db command (status / prepare / migrate) against the dev or prod
# environment by connecting directly to the remote Postgres + Elasticsearch
# over Tailscale, using admin credentials sourced from .kamal/secrets.<env>.
#
# Replaces the old toolbox accessory: no admin credentials live on the server,
# no separate image to build/push, no always-running container.

REMOTE_HOST="100.114.126.96"
PROD_FLAG="--allow-prod"

usage() {
  cat <<EOF
Usage: scripts/remote-db.sh <env> <command> [${PROD_FLAG}]

  env:      dev | prod
  command:  status | prepare | migrate

For prepare/migrate against prod, ${PROD_FLAG} is required as a safety check.
status is read-only and never requires the flag.

Examples:
  scripts/remote-db.sh dev status
  scripts/remote-db.sh dev prepare
  scripts/remote-db.sh prod status
  scripts/remote-db.sh prod prepare ${PROD_FLAG}
EOF
}

ENV="${1:-}"
CMD="${2:-}"
FLAG="${3:-}"

if [[ -z "$ENV" || -z "$CMD" ]]; then
  usage
  exit 1
fi

case "$ENV" in
  dev|prod) ;;
  *) echo "error: env must be 'dev' or 'prod' (got '$ENV')" >&2; exit 1 ;;
esac

case "$CMD" in
  status|prepare|migrate) ;;
  *) echo "error: command must be 'status', 'prepare' or 'migrate' (got '$CMD')" >&2; exit 1 ;;
esac

if [[ "$ENV" == "prod" && "$CMD" != "status" && "$FLAG" != "$PROD_FLAG" ]]; then
  echo "error: '$CMD' against prod requires $PROD_FLAG" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS_FILE="$REPO_ROOT/.kamal/secrets.$ENV"

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "error: $SECRETS_FILE not found" >&2
  exit 1
fi

if ! command -v tailscale >/dev/null 2>&1; then
  echo "error: tailscale CLI not found - this script needs Tailscale to reach $REMOTE_HOST" >&2
  exit 1
fi

if ! tailscale status >/dev/null 2>&1; then
  echo "error: Tailscale is not running" >&2
  exit 1
fi

if ! ping -c 1 -W 2 "$REMOTE_HOST" >/dev/null 2>&1; then
  echo "error: cannot reach $REMOTE_HOST over Tailscale" >&2
  exit 1
fi

cd "$REPO_ROOT"

if [[ "$ENV" == "prod" ]]; then
  APP_ENV="production"
else
  APP_ENV="development"
fi
ES_INDEX="nadedb_$ENV"

echo "→ Loading secrets from .kamal/secrets.$ENV (fetched from AWS SSM)..."
set -a
# shellcheck disable=SC1090
source "$SECRETS_FILE"
set +a

echo "→ Running 'db:$CMD' against $ENV"
echo "  postgres:      $REMOTE_HOST:5432/${POSTGRES_DB:-?} (app user: ${POSTGRES_USER:-?})"
echo "  elasticsearch: http://$REMOTE_HOST:9200 (index: $ES_INDEX)"
echo

POSTGRES_HOST="$REMOTE_HOST" \
POSTGRES_PORT=5432 \
ELASTICSEARCH_HOST="http://$REMOTE_HOST:9200" \
ELASTICSEARCH_INDEX="$ES_INDEX" \
ENVIRONMENT="$APP_ENV" \
bun run "db:$CMD"
