#!/usr/bin/env bash
set -euo pipefail

# Regenerate the contributor seed dump from the production database and upload it
# to the R2 bucket the seed worker serves.
#
# Usage:
#   infra/seed-worker/scripts/refresh-seed-dump.sh [--no-upload] [--output FILE]
#
#   --no-upload   dump and verify only; leave the file on disk
#   --output      where to write the dump (default: infra/seed-worker/seed.dump)
#
# Requires SSH access to the `nadeshiko` host over Tailscale. Uploading also
# requires CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID and the repo's pinned
# wrangler, so run `npm ci` at the repository root first.
#
# ---------------------------------------------------------------------------
# The seed is downloadable by anyone holding SEED_TOKEN, and it is built from the
# production database. So this dumps an explicit allowlist of content tables —
# never the whole database.
#
# An allowlist, not an exclude list: with an exclude list, a table added later
# leaks by default, and the tables being kept out here are user emails, session
# tokens, OAuth refresh tokens and API keys. A new content table missing from the
# seed is a nuisance; a new identity table in the seed is a breach. Adding a
# table below is a deliberate act — check what is in it first.
#
# SegmentRevision is deliberately absent: it carries a user_id foreign key, so it
# would either dangle or drag User in. WordFrequency is absent too — it is not
# production content but a ranked list built locally by
# backend/scripts/seed-word-frequency.ts.
#
# This list mirrors SEED_CONTENT_TABLES in backend/bin/setup.ts, which is the
# consumer: it restores data-only with its own -t allowlist. Dumping a table that
# side does not restore just makes the download bigger. Change both together,
# and keep the two in the same order so a mismatch is visible at a glance.
# ---------------------------------------------------------------------------

TABLES=(
  Media
  Episode
  Segment
  MediaExternalId
)

remote=${REMOTE_HOST:-nadeshiko}
pg_container=${PG_CONTAINER:-nadeshiko-backend-prod-postgres}
bucket=${SEED_BUCKET:-nadeshiko-seed}
object=${SEED_OBJECT:-seed.dump}

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
output="${repo_root}/infra/seed-worker/seed.dump"
upload=true

while [ $# -gt 0 ]; do
  case "$1" in
    --no-upload) upload=false; shift ;;
    --output) output=${2:?--output requires a path}; shift 2 ;;
    -h|--help) sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "error: unknown argument '$1'" >&2; exit 1 ;;
  esac
done

table_args=""
for table in "${TABLES[@]}"; do
  table_args+=" --table='public.\"${table}\"'"
done

echo "→ Dumping ${#TABLES[@]} content tables from ${remote}:${pg_container}"

# pg_dump runs inside the container as the superuser over the local socket, so no
# password crosses the network and no credential is staged anywhere. Custom
# format (-Fc) matches what the existing README documents restoring.
tmp_dump=$(mktemp)
trap 'rm -f "$tmp_dump"' EXIT

# shellcheck disable=SC2029  # $table_args is built locally on purpose
ssh "$remote" "docker exec '${pg_container}' bash -ceu '
  pg_dump -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" \
    --format=custom --no-owner --no-privileges ${table_args}
'" >"$tmp_dump"

if [ ! -s "$tmp_dump" ]; then
  echo "error: pg_dump produced an empty file" >&2
  exit 1
fi

# Verify what actually landed rather than trusting the flags: a typo in a table
# name makes pg_dump fail loudly, but a change in how --table globs are quoted
# could silently widen the dump. Every table in the archive must be on the list.
echo "→ Verifying the dump contains only allowlisted tables"
# TOC lines read `; <id>; <oid> <oid> TABLE DATA <schema> <table> [owner]`, and
# --no-owner can drop the trailing field, so index forward from the tag rather
# than backwards from the end.
dumped=$(pg_restore --list "$tmp_dump" |
  awk '/ TABLE DATA /{for (i = 1; i <= NF; i++) if ($i == "DATA") { print $(i + 2); break }}' |
  sort -u)
unexpected=""
while IFS= read -r table; do
  [ -n "$table" ] || continue
  found=false
  for allowed in "${TABLES[@]}"; do
    [ "$table" = "$allowed" ] && found=true && break
  done
  [ "$found" = true ] || unexpected+="  ${table}"$'\n'
done <<<"$dumped"

if [ -n "$unexpected" ]; then
  echo "error: the dump contains tables that are not on the allowlist:" >&2
  printf '%s' "$unexpected" >&2
  echo "Refusing to publish. This dump may contain user data." >&2
  exit 1
fi

echo "  tables in dump:"
awk '{print "    " $0}' <<<"$dumped"

mkdir -p "$(dirname "$output")"
cp "$tmp_dump" "$output"
echo "→ Wrote $(du -h "$output" | cut -f1) to ${output}"

if [ "$upload" != true ]; then
  echo "--no-upload: not publishing."
  exit 0
fi

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required to upload (scope: R2 write on ${bucket})}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required to upload}"

echo "→ Uploading to r2://${bucket}/${object}"
cd "${repo_root}/infra/seed-worker"

# Run the wrangler pinned in infra/seed-worker's devDependencies rather than
# resolving one over the network: a fetched wrangler is an unpinned version
# uploading to a production bucket. npm workspaces hoist the binary to the root
# node_modules, so look there first and fall back to the workspace's own.
export PATH="${repo_root}/node_modules/.bin:${repo_root}/infra/seed-worker/node_modules/.bin:${PATH}"
if ! command -v wrangler >/dev/null 2>&1; then
  echo "error: wrangler not found. Run 'npm ci' at the repository root first." >&2
  exit 1
fi

wrangler r2 object put "${bucket}/${object}" --file "$output" --remote

echo
echo "Done. Contributors get the new dump on their next seed download."
