# Elasticsearch 9 migration

Nadeshiko upgrades the JavaScript client from 8.19.2 to 9.4.2 and the custom server image from the 8.x line to Elasticsearch 9.4.1.

## Why the server is 9.4.1

Elasticsearch 9.4.4 is the newest upstream server release at the time of this change. Nadeshiko requires `analysis-sudachi`, and Sudachi 3.6.0 publishes exact Elasticsearch builds only through 9.4.1. Elasticsearch plugins must match the server version exactly. Therefore 9.4.1 is the newest safe server version currently available for Nadeshiko; moving to 9.4.4 is blocked until an exact Sudachi artifact exists and passes the same gates.

The client can be 9.4.2 with server 9.4.1. This pairing passed the full backend suite and runtime search/analyzer gates.

## Data strategy

Production Elasticsearch contains a derived search index whose authoritative source is PostgreSQL. The release does **not** open the Elasticsearch 8 data directory with Elasticsearch 9:

1. resolve reviewed, commit-bound Elasticsearch and backend tags to immutable digests;
2. stop `kamal-proxy` and every production backend process, freezing API and worker writes;
3. stop and rename the existing Elasticsearch 8 container while retaining `nadeshiko-elasticsearch-data` untouched;
4. require that `nadeshiko-elasticsearch-v9-data` does not already exist, then boot Elasticsearch 9 on that fresh volume;
5. run the new backend image as an unexposed one-off migration container and rebuild the index from PostgreSQL;
6. verify cluster health, bulk-item success, counts, aliases, plugins, runtime version, and Japanese baseform analysis;
7. deploy and expose the client-9 backend only after every migration gate passes;
8. retain the stopped Elasticsearch 8 container and volume through the rollback observation window.

This fresh-volume rebuild avoids an in-place, irreversible data-directory upgrade: no Elasticsearch 8 data directory is ever opened by Elasticsearch 9.

### The 8.19.15 bridge image is still a prerequisite

Not opening the old data directory removes the *format* reason to traverse 8.19, but it does not remove the traversal. `scripts/migrate-elasticsearch-production.sh` fails closed unless the running production container reports `Version: 8.19.15`, so production must already be on the bridge image before a tagged release can migrate it. There is no automation for the 8.17.10 → 8.19.15 step; it is an operator action.

The bridge image is published and immutable, but the repository can no longer rebuild it. `backend/docker/Dockerfile.elasticsearch` now pins 9.4.1, and both the release and canary workflows resolve the Dockerfile's own last-touching commit, which is the 9.4.1 revision. Reproducing the bridge image means checking out commit `0e10441` and building from there. The published tags are:

```text
ghcr.io/brigadasos/nadeshiko-elasticsearch:8.19.15-sudachi-3.6.0-dict-20260116
ghcr.io/brigadasos/nadeshiko-elasticsearch:8.19.15-sudachi-3.6.0-dict-20260116-0e10441566f2ee5dceb02b449d99086e5e768cef
```

## Compatibility and safety gates

Validated before publication:

- client 8.19.2 against server 9.4.1: pass;
- client 9.4.2 against server 9.4.1: pass;
- client 9 against server 8: rejected, so server migration precedes backend deployment;
- full backend suite against Elasticsearch 9.4.1;
- ICU and Sudachi plugin presence;
- real Nadeshiko mappings and Japanese baseform query (`食べました` → `食べる`);
- explicit 30-second timeout on every application/admin Elasticsearch client;
- R2 S3-compatible snapshot/create/delete/restore drill;
- Docker backend image contains the controlled DB/ES migration CLIs.
- bulk item failures abort population and prevent the alias swap;
- cluster readiness requires `timed_out=false` and yellow/green health, not merely HTTP 200.

## Staging sequence

A merge that changes Elasticsearch paths does not automatically deploy the backend. This avoids deploying client 9 while the isolated staging server is absent or still on Elasticsearch 8. Every later staging backend deployment also verifies the 9.4.1 server and both required plugins, so an unrelated merge cannot bypass the canary gate.

After the Elasticsearch image publication workflow succeeds, dispatch `[Stg] Release` with `bootstrap_elasticsearch_canary=true`. The workflow:

1. proves the semantic component tag and the Dockerfile-commit tag resolve to the same registry digest;
2. recreates only the isolated staging Elasticsearch container on its fresh v9 volume;
3. verifies Elasticsearch 9.4.1 plus ICU/Sudachi;
4. deploys the client-9 backend;
5. prepares/reindexes `nadedb_dev` from PostgreSQL;
6. checks DB/ES count parity and Japanese analysis;
7. runs the existing public staging E2E gate.

Staging uses `nadeshiko-backend-stg-elasticsearch` and the fresh `nadeshiko-elasticsearch-stg-v9-data` volume; it no longer points at the production Elasticsearch container.

## Production release and rollback

Production changes only from the tagged `[Prod] Release` workflow. A normal merge does not run the production migration.

The release validates the actual triggering tag (`GITHUB_REF_NAME`), requires its SHA to be on `main`, and proves the semantic Elasticsearch tag equals the Dockerfile-commit tag before using the resulting digest. It also resolves the release backend SHA tag to a digest. Kamal is forced to that exact release SHA, and the migration script requires every running production web container to report both the expected release version and the image ID obtained from the reviewed digest before accepting the deployment. Administrative SSM values are rejected if empty or if they contain CR/LF before a `0600` env file is created.

The workflow and a host-side lock serialize migration attempts. The script fails closed unless the current container is Elasticsearch 8.19.15 on the expected old volume, the v9 volume is absent, the proxy is running, and the previous application version can be identified for an explicit Kamal rollback. It preserves the old Elasticsearch container under:

```text
nadeshiko-backend-prod-elasticsearch-es8-rollback
```

Before rebuilding, the script stops ingress and all backend processes. Therefore PostgreSQL and Elasticsearch cannot diverge during the copy or rollback window. If migration fails before application deployment, it removes only the new ES9 container, restores the unchanged ES8 container, and restarts the retained application/proxy stack. A failed v9 volume is deliberately retained for inspection and must be explicitly cleared before retrying.

If Kamal deployment is attempted and fails, the script explicitly rolls the application back to the captured previous version while retaining the already-complete ES9 index. It does not restore a stale ES8 index after traffic may have resumed.

After a successful release, do not delete the retained Elasticsearch 8 container or volume until the observation window and external E2E/telemetry review are complete. Any later operator-initiated return to ES8 requires another write freeze and an authoritative PostgreSQL reindex before traffic resumes; alias reversal alone is not data recovery.
