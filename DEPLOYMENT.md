# Deployment

This repo deploys itself through GitHub Actions. You normally never run
`kamal` by hand: you push code (or a tag) and the right workflow builds the
image, ships it to the server over Tailscale, and runs the post-deploy checks.

There are two environments:

| Environment | URL | Triggered by |
| --- | --- | --- |
| Staging (stg) | https://stg.nadeshiko.co | every push to `main` |
| Production (prod) | https://nadeshiko.co | pushing a `vX.Y.Z` tag |

Everything is a single host (`nadeshiko`, reached over Tailscale) running
[Kamal](https://kamal-deploy.org/) with `kamal-proxy`. Backend, frontend and
the Discord bot are separate Kamal services on that host.

## Mental model

- **`main` is staging.** Any merge or direct push to `main` deploys to stg.
- **A `vX.Y.Z` tag is production.** Tagging a commit deploys that commit to prod.
- **The OpenAPI spec drives the SDKs.** When the spec changes, the SDK repos
  rebuild and publish a new package. The frontend consumes the TypeScript SDK,
  so backend API changes flow to the frontend through a published SDK version,
  not through direct imports.

We have not split prod into separate backend/frontend tags. A single `vX.Y.Z`
tag releases the whole stack.

## Staging: pushing to `main`

Workflow: [`.github/workflows/staging-release.yml`](.github/workflows/staging-release.yml)
(`[Stg] Release`).

On every push to `main` it looks at which paths changed and only does the
relevant work:

| Path changed | What happens |
| --- | --- |
| `backend/**` | Build + deploy backend to stg (`kamal deploy -d staging`) |
| `frontend/**` | Build + deploy frontend to stg |
| `backend/docs/openapi/**` | Dispatch an **internal** SDK rebuild (TS + Python) |
| `discord/**` | Deploy the Discord bot to **prod** (see note below) |

After the backend and/or frontend deploy, the E2E suite runs against
`https://stg.nadeshiko.co`.

A backend change that does **not** touch the OpenAPI spec deploys the backend
but does not rebuild any SDK. Only changes under `backend/docs/openapi/**`
trigger an SDK rebuild.

### Internal SDK versions

When the spec changes on `main`, the staging workflow sends a
`repository_dispatch` to the SDK repos with `release_channel=internal`:

- TypeScript: https://github.com/BrigadaSOS/nadeshiko-sdk-ts
- Python: https://github.com/BrigadaSOS/nadeshiko-sdk-python

The TS SDK is published to npm as a prerelease, for example
`@brigadasos/nadeshiko-sdk@2.2.0-internal.<hash>`. The base version (`2.2.0`)
comes from the backend version; only the `<hash>` suffix changes per build.
See the versions tab:
https://www.npmjs.com/package/@brigadasos/nadeshiko-sdk?activeTab=versions

## A typical change that spans backend and frontend

Because the frontend talks to the backend through the published SDK, a change
that touches the API contract is a two-step dance.

### Step 1: ship the backend

1. Change the backend: update the OpenAPI spec under
   `backend/docs/openapi/**` and the implementation.
2. Push to `main` (directly or via a merged PR).
3. The staging workflow deploys the new backend to stg and, because the spec
   changed, dispatches a new **internal** SDK build.
4. Wait for the new SDK version to appear on npm, for example
   `@brigadasos/nadeshiko-sdk@2.2.0-internal.<00002>`.

### Step 2: ship the frontend

1. In `frontend/package.json`, bump `@brigadasos/nadeshiko-sdk` from the old
   internal version (`...-internal.<00001>`) to the new one
   (`...-internal.<00002>`) and install.
2. Finish the frontend implementation against the new SDK types.
3. Push to `main`. The staging workflow deploys the new frontend to stg.

If you prefer PRs, this is two PRs: one for the backend (merge first), then one
for the frontend that bumps the SDK version. The frontend PR depends on the
backend SDK build existing, so it has to come second. Pushing straight to
`main` works too and is what we often do in practice.

## Production: tagging a release

Workflow: [`.github/workflows/release.yml`](.github/workflows/release.yml)
(`[Prod] Release`), triggered by pushing a tag matching `v*`.

A prod release deploys backend and frontend to prod, publishes the **stable**
(public, non-internal) SDKs, and creates a GitHub Release.

The tag version must match the version recorded in the package files, so bump
the version first, then tag the resulting commit.

From the repository root:

```bash
# 1. Bump version across backend + frontend package.json and the OpenAPI spec
bun run release:set-version 1.2.3
bun run release:check-version 1.2.3

# 2. Commit the bump to main (push to main -> staging picks it up)
#    ...commit and push as usual...

# 3. Tag that commit and push the tag -> triggers the prod release
git tag -a v1.2.3 -m "v1.2.3"
git push origin v1.2.3
```

What the prod workflow does, in order:

1. Validates the tag is semver and matches `release:check-version`.
2. Builds and deploys the **backend** to prod (`kamal deploy -d prod`).
3. Builds and deploys the **frontend** to prod (runs after the backend).
4. Runs E2E against `https://nadeshiko.co`.
5. Dispatches **stable** SDK releases (TS + Python) -> public npm/PyPI versions.
6. Creates a GitHub Release with the public OpenAPI spec attached.

## Discord bot

Workflow: [`.github/workflows/release-discord.yml`](.github/workflows/release-discord.yml).

The Discord bot deploys to **prod** on any push to `main` that touches
`discord/**`. It is not part of the staging environment and is not gated behind
a `vX.Y.Z` tag.

## What happens on a backend deploy (migrations)

The backend applies pending database migrations automatically on boot in the
deployed environments. This is controlled by the `RUN_MIGRATIONS_ON_BOOT` flag,
set to `"true"` in `backend/config/deploy.prod.yml` and
`backend/config/deploy.staging.yml`.

Each deploy starts a fresh container. `main.ts` runs the initializers — database
connect, pending TypeORM migrations (as the app DB role), then workers — and
only calls `server.listen()` once they all succeed. A failed migration therefore
does not produce an unhealthy container: `runInitializers` throws, the shutdown
initializers roll back what started, and the process exits 1 without ever
binding a port. kamal-proxy's health check gets connection-refused for the whole
deploy timeout, the deploy fails, and the previous container keeps serving. Either
way a bad migration fails the deploy instead of shipping a broken app, but the
mechanism is process exit, not a health-check response.

This covers applying migrations to an already-provisioned database. Creating a
brand-new environment (role, database, grants) is still a one-time
`bun run db:bootstrap` with admin credentials. To run migrations manually
out of band, use `backend/scripts/remote-db.sh <env> migrate` (that script
reaches the host over Tailscale and sources `.kamal/secrets.<env>`; `env` is
`dev` or `prod`, and anything that writes to prod needs `--allow-prod`).

## Health checks

Every service answers `GET /up`, and kamal-proxy polls it during a deploy to
decide when the new container may take traffic. Each image also declares a
Docker `HEALTHCHECK` hitting the same endpoint, which is what surfaces a service
that goes bad *between* deploys (`docker ps` shows the health state).

The backend's `/up` verifies its dependencies, and the two are deliberately
treated differently:

| Dependency | On failure | Why |
| --- | --- | --- |
| Postgres | `503`, `{"status":"error","database":"down"}` | Nothing the API does works without it, so a container that cannot reach the database must never take traffic. |
| Elasticsearch | still `200`, with `"elasticsearch":"down"` | Only search degrades. Failing the check would restart-loop the whole API and turn a search outage into a total outage. |

Both probes are capped at two seconds and the result is cached for five, so the
once-a-second polling during a deploy costs at most one round trip per five
seconds. Alerting on a degraded search index reads the `elasticsearch` field —
it will never show up as a failed health check.

The frontend's `/up` is liveness only. It does not probe the backend on purpose:
during a backend outage, cached and static pages still render, and gating on the
backend would take the site down and restart-loop Nitro for no gain. The Discord
bot serves `/up` from a small HTTP server (`discord/src/health.ts`) on
`HEALTH_PORT`, which its Docker `HEALTHCHECK` polls; it runs with `proxy: false`
so there is no kamal-proxy check for it.

## Container logs

Kamal's default is a single 10 MB json-file per container with no rotation
history, and accessories get no log options at all — an Elasticsearch or
Postgres container would grow its log unbounded on the host disk. Each service's
`config/deploy.yml` sets a root-level `logging:` block (20 MB × 5 files) for app
containers, and every accessory in `backend/config/deploy.prod.yml` /
`deploy.staging.yml` repeats it under `options:` (`log-driver` / `log-opt`),
which is the only place accessories accept it.

## Elasticsearch

Background and the reasoning behind the current version pinning live in
[`backend/docs/elasticsearch-9-migration.md`](backend/docs/elasticsearch-9-migration.md).
The short version: the server is pinned to 9.4.1 because `analysis-sudachi`
publishes exact-version builds only up to that release, and Elasticsearch
plugins must match the server version exactly.

Local development builds the same image from
`backend/docker/Dockerfile.elasticsearch`, and because Docker never rebuilds a
locally built image on its own, a bumped pin leaves your machine on the old one
until you rebuild — and a major-version jump additionally requires discarding the
local data volume. See
[CONTRIBUTING.md](CONTRIBUTING.md#keeping-the-local-elasticsearch-image-current).
Deployed environments are unaffected: every deploy pulls an immutable published
tag.

### The staging canary gate

A merge that touches Elasticsearch paths does **not** deploy the backend on its
own. `staging-release.yml` has an `elasticsearch` path filter covering
`backend/docker/Dockerfile.elasticsearch`, `backend/config/elasticsearch.ts`,
`backend/config/elasticsearch-client.ts`, `backend/config/deploy.staging.yml`
and `backend/scripts/bootstrap-elasticsearch-staging-canary.sh`. When any of
those change, `deploy-backend` only runs if the `bootstrap-elasticsearch-canary`
job succeeded — and that job only runs on an explicit dispatch. The point is to
never ship a client-9 backend at a staging server that is absent or still on 8.

So after publishing a new Elasticsearch image, or after changing any of those
paths, dispatch `[Stg] Release` from the Actions tab with
`bootstrap_elasticsearch_canary = true`. The canary job proves the semantic
component tag and the Dockerfile-commit tag resolve to the same registry digest,
recreates only the isolated staging Elasticsearch container on its fresh v9
volume, verifies 9.4.1 plus the ICU and Sudachi plugins, then lets the backend
deploy, reindex `nadedb_dev` from Postgres, check DB/ES count parity and
Japanese analysis, and run the staging E2E gate.

If you merge one of those paths without dispatching the canary, the staging
backend simply does not deploy. That is the gate working as designed, not a
broken build.

### Recovering Elasticsearch

**The index is derived data. There is no Elasticsearch backup and none is
needed** — Postgres is the authoritative source and the index is rebuilt from
it. Recovery from a lost, corrupted or unopenable ES volume is a reindex, not a
restore:

Run it **inside the deployed backend container**, not from your machine — the
local `bun run es:*` scripts read your `.env` and would target your dev index:

```bash
cd backend
kamal app exec -d prod --reuse 'node --import tsx bin/es.ts status'
kamal app exec -d prod --reuse 'node --import tsx bin/es.ts reindex --allow-prod-destructive'
```

`--allow-prod-destructive` is required by `bin/destructiveGuard.ts` for every
destructive `es:` command when `ENVIRONMENT=production`; on staging (`-d
staging`) it is not. A reindex builds into a new versioned index and swaps the
alias only after the bulk load succeeds, so a failed rebuild leaves the previous
index serving. `es:status` is the verification step — it reports whether the
index count matches the database segment count.

Because search is soft-failed in `/up` (see [Health checks](#health-checks)),
the API stays up and serving non-search traffic for the whole rebuild.

### Removing the ES8 rollback stack

The 8 → 9 migration renames the old Elasticsearch container to
`nadeshiko-backend-prod-elasticsearch-es8-rollback` and leaves its
`nadeshiko-elasticsearch-data` volume untouched, so the way back is a rename
rather than a rebuild. Both are meant to be removed once the observation window
closes — ES9 serving, E2E green, search telemetry reviewed.

```bash
backend/scripts/cleanup-es8-rollback.sh --dry-run   # report only
backend/scripts/cleanup-es8-rollback.sh             # prompts for confirmation
```

The script refuses to run unless production Elasticsearch is actually on 9.4.1
and healthy, so it cannot be used to delete the fallback while the migration is
incomplete. What you give up by running it is the fast path back to ES8; the
index itself is derived data and is always rebuildable from Postgres.

Afterwards, the 8 → 9 branch of `scripts/migrate-elasticsearch-production.sh`
is dead and should be deleted along with its rollback plumbing. Until then it is
live code: as of writing, the migration has never run, because it landed on
`main` after the newest release tag and only a `v*` tag invokes it.

## Postgres backups and restore

The `pg-backup` accessory in `backend/config/deploy.prod.yml` runs
[kartoza/pg-backup](https://github.com/kartoza/docker-pg-backup) on a
`0 2 * * *` cron and pushes to Cloudflare R2 over the S3 API, keeping 30 days
(`REMOVE_BEFORE: "30"`).

The layout it writes, with the defaults this deployment uses (`DUMPPREFIX=PG`,
`DUMP_ARGS=-Fc`, whole-database dumps):

```
s3://<R2_BACKUP_BUCKET>/globals.sql                                # roles/globals, overwritten every run
s3://<R2_BACKUP_BUCKET>/<YYYY>/<Month>/PG_<db>.<DD-Month-YYYY>.dmp.gz
```

for example `2026/August/PG_nadeshiko.05-August-2026.dmp.gz`. The dumps are
Postgres custom format, so they restore with `pg_restore`, not `psql`.

### Restore runbook

> Restoring **drops and recreates the target database**. Stop the backend first
> so nothing writes to a half-restored database.

1. Stop application writes:

   ```bash
   cd backend && kamal app stop -d prod
   ```

2. Confirm the dump you want exists before touching anything. The accessory
   container already has the R2 credentials and `s3cmd` configured:

   ```bash
   ssh nadeshiko 'docker exec nadeshiko-backend-prod-pg-backup \
     s3cmd ls -r s3://<R2_BACKUP_BUCKET>/2026/August/'
   ```

3. Restore. `restore.sh <date> <database>` resolves the object key from the
   date, drops the target database, recreates it and runs `pg_restore -j 4`:

   ```bash
   ssh nadeshiko 'docker exec nadeshiko-backend-prod-pg-backup \
     /backup-scripts/restore.sh "2026-08-05" nadeshiko'
   ```

4. Re-establish ownership and grants. kartoza recreates the database owned by
   the role in its own `POSTGRES_USER`, which the deploy config maps to
   `POSTGRES_ADMIN_USER` — but the app connects as the *app* role, and
   `bin/dbBootstrap.ts` is what grants that role schema/table/sequence
   privileges (public and pgboss). Skipping this leaves the app unable to read
   its own tables:

   ```bash
   cd backend && scripts/remote-db.sh prod prepare --allow-prod
   ```

   (`prepare` re-runs the bootstrap when `POSTGRES_ADMIN_PASSWORD` is present,
   then applies any pending migrations, so the schema is reconciled too.)

5. Bring the backend back and confirm it is serving:

   ```bash
   cd backend && kamal app boot -d prod
   scripts/remote-db.sh prod status
   curl -sS https://api.nadeshiko.co/up
   ```

6. Rebuild the search index from the restored database — it is derived data and
   is now stale relative to what you restored. Expect `/up` to report
   `"elasticsearch":"down"`-or-stale until this finishes:

   ```bash
   kamal app exec -d prod --reuse 'node --import tsx bin/es.ts reindex --allow-prod-destructive'
   ```

This runbook has **not** been rehearsed end to end against a real dump.
Rehearsing it (into a scratch database, not prod) is tracked as follow-up work.

## Deploy annotations

Each service's `.kamal/hooks/post-deploy` calls
`scripts/grafana-annotate-deploy.sh`, which posts a Grafana annotation tagged
`deploy` and `<service>` so deploys line up against metrics. It needs
`GRAFANA_ANNOTATION_TOKEN`, read from the **shared** SSM path
`/nadeshiko/shared/GRAFANA_ANNOTATION_TOKEN`. The script itself is
best-effort: a missing token or a failed curl logs a warning and exits 0.

Only production defines this secret. Staging deploys skip annotation (the
hook's missing-token warning). If staging annotations are ever wanted, add
`GRAFANA_ANNOTATION_TOKEN=$(.kamal/ssm-secret shared GRAFANA_ANNOTATION_TOKEN)`
back to the staging secrets files — and note `.kamal/ssm-secret` exits
non-zero on a denied read, so the staging OIDC role
`github-actions-nadeshiko-staging` must first get `ssm:GetParameter` (plus
`kms:Decrypt`) on that shared parameter, or every staging deploy fails at
secret resolution.

## Alerting and dashboards

Alert rules and the dashboard export live in
[`infra/monitoring/`](infra/monitoring/README.md), which also documents how they
get provisioned onto the monitoring host.

The short version of the situation they address: Alertmanager has been running
on `monitoring:9093` with a working Discord receiver since June, and nothing has
ever sent it an alert — there is no vmalert and there are no rules. Production
backend telemetry stopped on 2026-07-24 and was still missing twelve days later
without anyone being told.

Two things are worth knowing before writing a rule of your own. Nadeshiko's only
metrics in VictoriaMetrics are span metrics derived from traces
(`traces_span_metrics_*`); the `nadeshiko` host runs no node_exporter, no
cAdvisor and no database exporters, and the `node_*`/`container_*` series in
that instance belong to an unrelated host. And VictoriaLogs holds no Nadeshiko
streams at all, so log-based alerting is not available.

`infra/monitoring/scripts/publish-host-metrics.sh` is the cheap way around the
first gap: one cron on the host publishes Elasticsearch health, Postgres backup
freshness and container restart counts, which is what the
`nadeshiko-host` rule group alerts on.

### Deploy failure notifications

The three deploy workflows call
[`notify-deploy-failure.yml`](.github/workflows/notify-deploy-failure.yml) with
`if: failure()`, which posts the failing job names and a run link to Discord. It
is gated on a `DISCORD_DEPLOY_WEBHOOK` repository secret and exits green with a
notice when that is absent, so it does not turn a missing webhook into a red
workflow. This is separate from the Alertmanager webhook above: one reports CI,
the other reports production.

## Refreshing the contributor seed

`bin/setup.ts` offers new contributors a seed database of real content, served
from R2 by [`infra/seed-worker`](infra/seed-worker/README.md).
`[Infra] Refresh seed dump` regenerates it from production over the same
SSH/Tailscale path deploys use. It is manual-dispatch-only and defaults to a dry
run; the monthly schedule in the workflow is commented out until it has been run
by hand a few times.

The dump is an explicit allowlist of content tables and the script refuses to
publish an archive containing anything else — the file is downloadable by anyone
with the seed token and it comes from the production database.

## Secrets and access

### SSH host keys

The deploy workflows pin the host's SSH public keys from
[`.github/known_hosts`](.github/known_hosts) instead of accepting whatever key
answers on the Tailnet. When that file has no entry for the host, the composite
action falls back to `ssh-keyscan` and prints a warning annotation on every
deploy, so an unpinned host is visible rather than silent.

Populating it is a one-time manual step, from a machine already on the Tailnet:

```bash
ssh-keyscan nadeshiko >> .github/known_hosts
```

Use plain `ssh-keyscan`, not `-H`. Verify the fingerprints against the host
before committing — pinning a key learned over the same channel you are trying
to protect proves nothing.

This covers the raw `ssh` calls, which is where most of the surface is: the
Elasticsearch migration, the staging canary bootstrap and every health probe in
the workflows all shell out to `ssh`. Kamal connects through net-ssh rather than
the OpenSSH binary, so whether `~/.ssh/config` governs its host key checking
depends on Kamal's own `verify_host_key` default — worth confirming before
treating the pin as covering deploys too.

### SES credentials are static keys

`SES_AWS_ACCESS_KEY_ID` / `SES_AWS_SECRET_ACCESS_KEY` are long-lived IAM user
keys held in SSM and injected into the backend container. Every other AWS
interaction in this repo already uses OIDC role assumption
(`aws-actions/configure-aws-credentials` with `role-to-assume`), so these are the
only static AWS credentials left, and nothing rotates them.

**TODO (infra, not doable from this repo):** replace them with either an instance
/ workload role the container assumes, or at minimum a documented rotation
schedule with two active keys so rotation does not require downtime. This needs
changes in the AWS account, so it cannot be done by editing anything here.

## Manual / emergency deploys

The staging workflow supports `workflow_dispatch` with `force_backend`,
`force_frontend` and `bootstrap_elasticsearch_canary` inputs, so you can
redeploy stg from the Actions tab without a code change.

To deploy from your own machine you need Tailscale access to the `nadeshiko`
host, Kamal installed, and the destination secrets. Then from the relevant app
directory:

```bash
cd backend   # or frontend / discord
kamal deploy -d staging   # or -d prod
```

Prefer the workflows; reach for a manual deploy only when CI is unavailable.
