#!/usr/bin/env bash
set -euo pipefail

# Run database/search commands against staging or production over Tailscale, using admin credentials from
# .kamal/secrets.<env>. The script replaces the old always-running toolbox accessory.
#
# Postgres and Elasticsearch publish on the host's 127.0.0.1 only (config/deploy.prod.yml), so nothing answers on the
# tailnet address. The script opens an SSH local port-forward to the host as the Kamal user, on two free local ports so
# it cannot collide with a local dev Postgres on 5432, points the commands at 127.0.0.1:<those ports>, and closes the
# tunnel on exit. Needs: Tailscale up, SSH access as `docker` (the same access `kamal` uses), and Node locally.
#
# Environment aliases map to three names: staging/stg/dev use .kamal/secrets.staging, nadeshiko-dev, and nadedb_dev;
# prod uses the corresponding production names.

REMOTE_NODE="nadeshiko"
REMOTE_HOST=""
REMOTE_SSH_USER="docker"
TUNNEL_PID=""
PROD_FLAG="--allow-prod"

usage() {
  cat <<EOF
Usage: scripts/remote-db.sh <env> <command> [${PROD_FLAG}]

  env:      staging (aliases: stg, dev) | prod
  command:  status | prepare | migrate | parse-corpus | reindex | reindex-media <publicId>
            | audit-wakati | create-service-key -- --user <id|email> --name <label> --permissions <scopes>

For prepare/migrate against prod, ${PROD_FLAG} is required as a safety check.
status and audit-wakati are read-only and never require the flag.
Connects through an SSH tunnel to the host's loopback-only Postgres (5432) and Elasticsearch (9200).

Examples:
  scripts/remote-db.sh staging status
  scripts/remote-db.sh staging migrate
  scripts/remote-db.sh staging reindex
  scripts/remote-db.sh staging reindex-media BKncctxoiaJH
  scripts/remote-db.sh prod status
  scripts/remote-db.sh prod reindex-media BKncctxoiaJH ${PROD_FLAG}
  scripts/remote-db.sh prod audit-wakati
  scripts/remote-db.sh prod create-service-key ${PROD_FLAG} -- --user <id|email> --name roxy-moderation --permissions READ_MEDIA,UPDATE_MEDIA,READ_ADMIN
  scripts/remote-db.sh prod prepare ${PROD_FLAG}
  scripts/remote-db.sh prod backfill-session-country ${PROD_FLAG} -- --db ~/GeoLite2-Country.mmdb
  scripts/remote-db.sh prod backfill-last-seen ${PROD_FLAG}
EOF
}

ENV="${1:-}"
CMD="${2:-}"
FLAG="${3:-}"

# The prod confirmation may sit anywhere after the command, so commands that take their own argument in position 3
# (reindex-media <publicId>) can still be confirmed for prod.
ALLOW_PROD=false
for arg in "${@:3}"; do
  [[ "$arg" == "$PROD_FLAG" ]] && ALLOW_PROD=true
done

if [[ -z "$ENV" || -z "$CMD" ]]; then
  usage
  exit 1
fi

# SECRETS_ENV selects the secrets file; DATA_ENV selects the database/index. They differ for staging, so map them here.
case "$ENV" in
  staging|stg|dev) SECRETS_ENV="staging"; DATA_ENV="dev" ;;
  prod)            SECRETS_ENV="prod";    DATA_ENV="prod" ;;
  *) echo "error: env must be 'staging' (or 'stg'/'dev') or 'prod' (got '$ENV')" >&2; exit 1 ;;
esac

case "$CMD" in
  status|prepare|migrate|parse-corpus|reindex|reindex-media|audit-wakati|backfill-session-country|backfill-last-seen|create-service-key) ;;
  *) echo "error: command must be status, prepare, migrate, parse-corpus, reindex, reindex-media, audit-wakati, backfill-session-country, backfill-last-seen or create-service-key (got '$CMD')" >&2; exit 1 ;;
esac

# Reindex rebuilds Elasticsearch from authoritative PostgreSQL, swaps a versioned alias with zero downtime, and is the
# recovery path for a lost index. Staging and production share the server, so a mistyped environment can still affect
# the other environment's index.

# parse-corpus writes tokens for every row and therefore needs the production write flag; audit-wakati is read-only and
# remains exempt so it can be run routinely.
if [[ "$ENV" == "prod" && "$CMD" != "status" && "$CMD" != "audit-wakati" && "$ALLOW_PROD" != true ]]; then
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

if ! command -v ssh >/dev/null 2>&1; then
  echo "error: ssh not found - the script tunnels to $REMOTE_NODE over SSH" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found - the commands run from this checkout" >&2
  exit 1
fi

# Ask the OS for two free ports rather than hardcoding them: a local dev Postgres on 5432 or Elasticsearch on 9200
# would otherwise silently receive the commands meant for the server.
read -r LOCAL_PG_PORT LOCAL_ES_PORT < <(node -e '
  const net = require("net");
  const grab = () => new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); });
  });
  Promise.all([grab(), grab()]).then((p) => console.log(p.join(" ")));
') || true
if [[ -z "${LOCAL_PG_PORT:-}" || -z "${LOCAL_ES_PORT:-}" ]]; then
  echo "error: could not pick free local ports for the tunnel" >&2
  exit 1
fi

close_tunnel() {
  if [[ -n "$TUNNEL_PID" ]] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill "$TUNNEL_PID" 2>/dev/null || true
    wait "$TUNNEL_PID" 2>/dev/null || true
  fi
}
trap close_tunnel EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "→ Opening SSH tunnel to $REMOTE_SSH_USER@$REMOTE_NODE ($REMOTE_HOST)..."
# BatchMode: the tunnel runs in the background and cannot answer a prompt. accept-new trusts a first-seen host key only
# (the address is a tailnet one); a changed key still fails.
ssh -N \
  -o BatchMode=yes \
  -o ExitOnForwardFailure=yes \
  -o StrictHostKeyChecking=accept-new \
  -o ConnectTimeout=10 \
  -o ServerAliveInterval=30 \
  -L "127.0.0.1:$LOCAL_PG_PORT:127.0.0.1:5432" \
  -L "127.0.0.1:$LOCAL_ES_PORT:127.0.0.1:9200" \
  "$REMOTE_SSH_USER@$REMOTE_HOST" &
TUNNEL_PID=$!

# Wait until both forwards accept connections, failing fast if ssh exits (auth refused, port taken).
tunnel_ready=false
for _ in $(seq 1 60); do
  kill -0 "$TUNNEL_PID" 2>/dev/null || break
  if (exec 3<>"/dev/tcp/127.0.0.1/$LOCAL_PG_PORT") 2>/dev/null \
    && (exec 3<>"/dev/tcp/127.0.0.1/$LOCAL_ES_PORT") 2>/dev/null; then
    tunnel_ready=true
    break
  fi
  sleep 0.25
done
if [[ "$tunnel_ready" != true ]]; then
  echo "error: SSH tunnel to $REMOTE_SSH_USER@$REMOTE_HOST did not come up" >&2
  echo "       check access with: ssh $REMOTE_SSH_USER@$REMOTE_HOST true" >&2
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
echo "  postgres:      $REMOTE_NODE:5432/${POSTGRES_DB:-?} via 127.0.0.1:$LOCAL_PG_PORT (app user: ${POSTGRES_USER:-?})"
echo "  elasticsearch: $REMOTE_NODE:9200 via http://127.0.0.1:$LOCAL_ES_PORT (index: $ES_INDEX)"
echo

run_with_env() {
  # Pin the public Shirabe endpoint: inheriting backend/.env could send a production parse to a developer laptop and
  # write those results into production. Staging uses the same public service.
  POSTGRES_HOST="127.0.0.1" \
  POSTGRES_PORT="$LOCAL_PG_PORT" \
  POSTGRES_ADMIN_HOST="127.0.0.1" \
  POSTGRES_ADMIN_PORT="$LOCAL_PG_PORT" \
  SHIRABE_API_BASE="https://shirabe.org" \
  ELASTICSEARCH_HOST="http://127.0.0.1:$LOCAL_ES_PORT" \
  ELASTICSEARCH_INDEX="$ES_INDEX" \
  ENVIRONMENT="$APP_ENV" \
  "$@"
}

case "$CMD" in
  parse-corpus)
    # Run from this checkout because the production image lacks the script; the environment below is what targets prod.
    run_with_env node --import tsx scripts/parse-corpus-with-shirabe.ts "${@:4}"
    ;;
  reindex)
    # Zero downtime: build a versioned index and swap the alias after completion.
    run_with_env node --import tsx bin/es.ts reindex
    ;;
  backfill-session-country)
    # One-time local GeoLite2 backfill from existing session IPs; no address is sent remotely. Arguments after -- pass
    # through to the script.
    run_with_env node --import tsx scripts/backfill-session-country.ts "${@:4}"
    ;;
  backfill-last-seen)
    # One-time backfill from the last session timestamp; run before session sweeping and touch only null rows. Put
    # --dry-run after --.
    run_with_env node --import tsx scripts/backfill-last-seen.ts "${@:4}"
    ;;
  audit-wakati)
    # Read-only: ranks every media by how morpheme-segmented its subtitles look,
    # using the same metric the ingest guard turns batches away on.
    run_with_env node --import tsx scripts/audit-wakati.ts "${@:3}"
    ;;
  reindex-media)
    MEDIA_ID=""
    for arg in "${@:3}"; do
      [[ "$arg" != "$PROD_FLAG" ]] && { MEDIA_ID="$arg"; break; }
    done
    [[ -n "$MEDIA_ID" ]] || { echo "error: reindex-media needs a media publicId" >&2; exit 1; }
    # In-place repair for one media, affecting thousands of documents rather than the full index.
    run_with_env node --import tsx scripts/reindex-media.ts --media "$MEDIA_ID"
    ;;
  create-service-key)
    # Named command only, not arbitrary script execution: it prints a credential once, and prod still requires the
    # confirmation flag. Arguments after -- pass through unchanged.
    run_with_env npm run create:service-key -- "${@:4}"
    ;;
  *)
    run_with_env npm run "db:$CMD"
    ;;
esac
