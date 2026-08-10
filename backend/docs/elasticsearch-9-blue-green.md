# Elasticsearch 9 migration, blue-green

The zero-downtime alternative to `scripts/migrate-elasticsearch-production.sh`,
and the consolidation of staging onto the same server.

## Why not the scripted path

`migrate-elasticsearch-production.sh` stops ingress and every backend process,
rebuilds onto a fresh v9 volume, and only then deploys. That freeze exists so
PostgreSQL and Elasticsearch cannot diverge mid-rebuild. It costs 20-30 minutes
of hard downtime.

Measured on production before this ran:

```
changed_24h   changed_7d   created_7d
          0            0            0
```

The corpus is static between ingests. The freeze protects against a divergence
that is not occurring, so the same rebuild can happen alongside a serving v8.

## Why the app cannot be deployed first

The release ships `@elastic/elasticsearch ^9.4.3`. A 9.x client sends
`compatible-with=9` and cannot talk to the 8.19 server production runs, so
deploying before the data moves breaks search instantly.

The rebuild therefore is NOT done by the deployed app. It runs in a one-off
container from the release image -- 9.x client, talking to the new v9 instance --
while the old app keeps serving v8 with its 8.x client. The two never meet.

## Preconditions

- production Elasticsearch reports exactly `8.19.15`
- `nadeshiko-elasticsearch-v9-data` does not exist
- the index is ~2.8 GB and the host has >10 GB free
- `Segment.tokens` is fully populated (1,318,847 of 1,318,847) -- the rebuild
  reads PostgreSQL, so anything missing there is missing from the new index, and
  the furigana the release renders comes from `tokens.f`

## Memory

The host has 7.75 GB and was already ~2 GB into swap with two Elasticsearch
instances running (prod 1.37 GB, staging 991 MB). A third does not fit, so
staging's is stopped first and never comes back -- see consolidation below.

## Sequence

1. Stop the staging Elasticsearch. Frees ~1 GB. Staging search is down until
   step 7; nothing else on staging is affected.
2. `docker run` Elasticsearch 9.4.1 under a TEMPORARY name on the fresh v9
   volume. Not `kamal accessory boot`, which would replace the live accessory
   container and take production down.
3. Rebuild `nadedb_prod` into the v9 instance from PostgreSQL, in a one-off
   container from the release image. Production keeps serving from v8.
4. Gate: document count equals the PostgreSQL segment count, and
   `_analyze` on `食べました` returns `食べる` (proves the Sudachi plugin and
   dictionary loaded).
5. Cut over: stop v8, rename it `nadeshiko-backend-prod-elasticsearch-es8-rollback`,
   rename v9 to the canonical `nadeshiko-backend-prod-elasticsearch`. This is the
   only moment anything is briefly wrong.
6. Tag the release. `migrate-elasticsearch-production.sh` sees 9.4.1 and takes
   its early exit -- the unrehearsed branch never executes and the release is an
   ordinary `kamal deploy`.
7. Point staging at the same server (consolidation) and rebuild `nadedb_dev`
   there.

## Rollback, by step

- **1-4**: nothing has changed for production. Delete the v9 container and its
  volume, restart the staging Elasticsearch.
- **5**: rename back. The ES8 container and its volume are untouched -- it is a
  rename, not a rebuild, and no v8 data is ever opened by v9.
- **6**: `kamal rollback` to the previous version. The ES8 container is retained
  and can be renamed back into place.
- **after the observation window**: returning to ES8 means a write freeze and an
  authoritative PostgreSQL reindex, because by then the two have diverged.
  Alias reversal is not data recovery.

Do not delete `…-es8-rollback` or `nadeshiko-elasticsearch-data` until the
observation window closes.

## Consolidation: one server, two indices

`deploy.staging.yml` and `deploy.prod.yml` each declared their own accessory, so
the box ran two Elasticsearch servers to serve two indices. They could not be
merged before now because they were on different major versions.

After step 6 both are 9.4.1, so staging points at the production server and
keeps its own index (`nadedb_dev`). This frees ~1 GB on a host that was
swapping.

The trade, stated plainly: staging operations now reach the production
Elasticsearch. Index names keep the data apart and `bin/es.ts` scopes itself to
its own alias, but a destructive command typed against staging is now typed
against the production server. That is a real reduction in isolation, accepted
for the memory.
