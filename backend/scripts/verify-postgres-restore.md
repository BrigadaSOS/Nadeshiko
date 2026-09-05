# Postgres restore verification

The nightly `.github/workflows/verify-backup.yml` checks production backup age
and size, downloads that same object, and runs:

```sh
bash backend/scripts/verify-postgres-restore.sh /path/to/backup.dmp.gz
```

The script also accepts `-` for a gzipped archive on stdin. It needs Docker and
uses `postgres:17`, matching production's major version. The temporary container
has no network access or published ports, is capped at 3 GiB and two CPUs, and
is removed with its anonymous data volume on success or failure. Allow disk space
for the decompressed archive, the restored database and its indexes/WAL (the
production database was approximately 5 GiB on 2026-09-05).

Verification decompresses the entire archive, checks its gzip checksum, and
restores schema, data, indexes and constraints with `pg_restore --exit-on-error`.
It then requires data in `User`, `Media`, `Episode`, `Segment` and `migrations`,
and rejects invalid public-schema indexes. Failure reaches the existing backup
warning notification job. Never upload the archive or restored data as CI artifacts.

Production ownership and grants are omitted in the scratch restore. This checks
database recoverability, not restoration of production roles, application boot,
Elasticsearch reconstruction or media availability. A failing or missing backup
must be investigated even if the application is currently healthy.
