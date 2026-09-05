#!/usr/bin/env bash
# Restore a gzipped custom-format pg_dump into a disposable, network-isolated
# Postgres 17 container. Accept '-' to stream the archive on stdin.
# Only the container created here is removed; no production connection is used.
set -euo pipefail

archive=${1:?Usage: verify-postgres-restore.sh backup.dmp.gz|-}
if [[ "$archive" != - && ! -f "$archive" ]]; then
  echo 'Backup archive does not exist.' >&2
  exit 1
fi

restore_container=''
cleanup() {
  if [[ -n "$restore_container" ]]; then
    docker rm --force --volumes "$restore_container" >/dev/null
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

restore_container=$(docker run --detach --network none --memory 3g --cpus 2 \
  --label nadeshiko.backup-restore-check=true \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=restore_verify \
  postgres:17 -c shared_preload_libraries=pg_stat_statements \
  -c maintenance_work_mem=256MB)

ready=false
for ((attempt=0; attempt<60; attempt++)); do
  if docker exec "$restore_container" pg_isready -U postgres -d restore_verify >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo 'Scratch Postgres did not become ready.' >&2
  exit 1
fi

echo 'Restoring schema, rows, indexes, and constraints into isolated Postgres 17.'
# Fully decompress first: pg_restore can stop reading a custom-format stream
# before gzip finishes, which would make pipefail report a spurious SIGPIPE.
# A file also allows parallel restore and verifies the complete gzip checksum.
# Owners and grants belong to production roles, which deliberately do not exist
# here. Data, schema, constraints, and indexes must all restore without errors.
restore() {
  docker exec -i "$restore_container" bash -o pipefail -c \
    'set -e; gzip -dc > /tmp/backup.dump; echo "Archive decompressed and checksum verified."; pg_restore --jobs=2 --exit-on-error --no-owner --no-privileges -U postgres -d restore_verify /tmp/backup.dump'
}
if [[ "$archive" == - ]]; then
  restore
else
  restore < "$archive"
fi

docker exec -i "$restore_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d restore_verify <<'SQL'
DO $$
DECLARE
  relation_name text;
  has_rows boolean;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['User', 'Media', 'Episode', 'Segment', 'migrations'] LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', relation_name) INTO has_rows;
    IF NOT has_rows THEN
      RAISE EXCEPTION 'Restored core table % is empty', relation_name;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT i.indisvalid
  ) THEN
    RAISE EXCEPTION 'Restored database contains invalid indexes';
  END IF;
END $$;
SQL
echo 'Restore verified: all core tables contain data and indexes are valid.'
