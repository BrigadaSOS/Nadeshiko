#!/usr/bin/env bash
set -euo pipefail

# Run a db or search command against staging or production by connecting
# directly to the remote Postgres + Elasticsearch over Tailscale, using admin
# credentials sourced from .kamal/secrets.<env>.
#
# Replaces the old toolbox accessory: no admin credentials live on the server,
# no separate image to build/push, no always-running container.
#
# ONE NAME FOR THE ENVIRONMENT, because it has three. Kamal calls it `staging`
# (.kamal/secrets.staging, config/deploy.staging.yml), the database is
# `nadeshiko-dev` and the search index is `nadedb_dev`. This script used to take
# only `dev` and then look for `.kamal/secrets.dev`, which has never existed --
# so `remote-db.sh dev status` failed on a missing file and nobody could tell
# whether that meant the environment was down. `staging`, `stg` and `dev` are all
# accepted now and mapped to the right three names.

REMOTE_NODE="nadeshiko"
REMOTE_HOST=""
PROD_FLAG="--allow-prod"

usage() {
  cat <<EOF
Usage: scripts/remote-db.sh <env> <command> [${PROD_FLAG}]

  env:      staging (aliases: stg, dev) | prod
  command:  status | prepare | migrate | parse-corpus | reindex | reindex-media <publicId>

For prepare/migrate against prod, ${PROD_FLAG} is required as a safety check.
status is read-only and never requires the flag.

Examples:
  scripts/remote-db.sh staging status
  scripts/remote-db.sh staging migrate
  scripts/remote-db.sh staging reindex
  scripts/remote-db.sh staging reindex-media BKncctxoiaJH
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

# SECRETS_ENV names the .kamal/secrets file; DATA_ENV names the database and the
# search index. They differ for staging and that is not going to be fixed by
# renaming a live database, so it is mapped here instead of remembered.
case "$ENV" in
  staging|stg|dev) SECRETS_ENV="staging"; DATA_ENV="dev" ;;
  prod)            SECRETS_ENV="prod";    DATA_ENV="prod" ;;
  *) echo "error: env must be 'staging' (or 'stg'/'dev') or 'prod' (got '$ENV')" >&2; exit 1 ;;
esac

case "$CMD" in
  status|prepare|migrate|parse-corpus|reindex|reindex-media) ;;
  *) echo "error: command must be status, prepare, migrate, parse-corpus, reindex or reindex-media (got '$CMD')" >&2; exit 1 ;;
esac

# A reindex rebuilds the whole search index. On production that is a destructive
# operation with its own runbook (scripts/migrate-elasticsearch-production.sh),
# so it is not offered here at all rather than guarded by a flag.
if [[ "$ENV" == "prod" && ( "$CMD" == "reindex" || "$CMD" == "reindex-media" ) ]]; then
  echo "error: '$CMD' is not available for prod here -- see scripts/migrate-elasticsearch-production.sh" >&2
  exit 1
fi

# parse-corpus writes `tokens` on every row, which is additive: nothing reads the
# column until the release that drops `pos_analysis`. It is still an hour of
# writes against production, so it asks for the same flag as a migration.
if [[ "$ENV" == "prod" && "$CMD" != "status" && "$FLAG" != "$PROD_FLAG" ]]; then
  echo "error: '$CMD' against prod requires $PROD_FLAG" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS_FILE="$REPO_ROOT/.kamal/secrets.$SECRETS_ENV"

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "error: $SECRETS_FILE not found" >&2
  exit 1
fi

if ! command -v tailscale >/dev/null 2>&1; then
  echo "error: tailscale CLI not found - this script needs Tailscale to reach $REMOTE_NODE" >&2
  exit 1
fi

if ! tailscale status >/dev/null 2>&1; then
  echo "error: Tailscale is not running" >&2
  exit 1
fi

# `tailscale ping` resolves peer names even when the operating system is not
# accepting MagicDNS. Extract the current IPv4 address instead of pinning it.
PING_OUTPUT="$(tailscale ping --timeout=5s --c=1 "$REMOTE_NODE" 2>&1)" || {
  echo "error: cannot reach $REMOTE_NODE over Tailscale" >&2
  echo "$PING_OUTPUT" >&2
  exit 1
}
if [[ "$PING_OUTPUT" =~ \(([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)\) ]]; then
  REMOTE_HOST="${BASH_REMATCH[1]}"
else
  echo "error: could not determine $REMOTE_NODE Tailscale IPv4 address" >&2
  echo "$PING_OUTPUT" >&2
  exit 1
fi

cd "$REPO_ROOT"

if [[ "$ENV" == "prod" ]]; then
  APP_ENV="production"
else
  APP_ENV="development"
fi
ES_INDEX="nadedb_$DATA_ENV"

echo "→ Loading secrets from .kamal/secrets.$SECRETS_ENV (fetched from AWS SSM)..."
set -a
# shellcheck disable=SC1090
source "$SECRETS_FILE"
set +a

echo "→ Running '$CMD' against $ENV"
echo "  postgres:      $REMOTE_HOST:5432/${POSTGRES_DB:-?} (app user: ${POSTGRES_USER:-?})"
echo "  elasticsearch: http://$REMOTE_HOST:9200 (index: $ES_INDEX)"
echo

run_with_env() {
  # SHIRABE_API_BASE is pinned, not inherited. `backend/.env` sets it to
  # `https://shirabe.localhost` for local development, and that value reaches a
  # script run from this checkout -- so a production corpus parse would have
  # asked a DEVELOPER'S LAPTOP to tokenize 1.3M rows and written the answers to
  # the production database. A self-signed certificate was the only thing that
  # stopped it, which is luck rather than a safeguard.
  #
  # There is one Shirabe and it is the public one; staging calls it too.
  POSTGRES_HOST="$REMOTE_HOST" \
  SHIRABE_API_BASE="https://shirabe.org" \
  POSTGRES_PORT=5432 \
  ELASTICSEARCH_HOST="http://$REMOTE_HOST:9200" \
  ELASTICSEARCH_INDEX="$ES_INDEX" \
  ENVIRONMENT="$APP_ENV" \
  "$@"
}

case "$CMD" in
  parse-corpus)
    # Runs from THIS checkout, not the deployed image: production's image predates
    # the script entirely, and staging's container is wired to the staging
    # database. The env below is the only thing that points it at prod.
    run_with_env node --import tsx scripts/parse-corpus-with-shirabe.ts "${@:4}"
    ;;
  reindex)
    # Zero downtime: builds a new versioned index and swaps the alias, so the
    # old one keeps answering until the new one is complete.
    run_with_env node --import tsx bin/es.ts reindex
    ;;
  reindex-media)
    [[ -n "$FLAG" ]] || { echo "error: reindex-media needs a media publicId" >&2; exit 1; }
    # In place, into the live index, for a few thousand documents rather than
    # 1.3M -- what a data repair on one media needs.
    run_with_env node --import tsx scripts/reindex-media.ts --media "$FLAG"
    ;;
  *)
    run_with_env npm run "db:$CMD"
    ;;
esac
