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
- **The OpenAPI spec drives the SDK, and the SDK lives in this repo.** The
  TypeScript SDK is a workspace package at `packages/nadeshiko-sdk`, generated
  from the spec by `npm run sdk:codegen`. The frontend and the Discord bot
  consume it directly as a workspace dependency, so an API change and the code
  using it land in the same commit. Nothing is published or version-pinned to
  move a change between them.

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
| `backend/docs/openapi/**` | Dispatch a **Python** SDK rebuild (the TS SDK is in-repo) |
| `discord/**` | Deploy the Discord bot to **prod** (see note below) |

After the backend and/or frontend deploy, the E2E suite runs against
`https://stg.nadeshiko.co`.

A backend change that does **not** touch the OpenAPI spec deploys the backend
but does not rebuild the Python SDK. Only changes under
`backend/docs/openapi/**` trigger that dispatch.

## A typical change that spans backend and frontend

This is a single commit. The TypeScript SDK is generated into
`packages/nadeshiko-sdk` and consumed from there by the frontend and the
Discord bot, so there is no publish step in the middle and nothing to wait for.

1. Update the OpenAPI spec under `backend/docs/openapi/**` and the backend
   implementation.
2. Regenerate: `npm run generate:api --workspace backend` (server types, route
   auth, error profiles, the Nitro proxy allowlist) and `npm run sdk:codegen`
   (the TypeScript SDK).
3. Write the frontend code against the new SDK types. They are already there —
   your editor resolves them from the workspace.
4. Commit everything together, including the regenerated `generated/`
   directories, and push.

CI fails the build if any generated output is stale, so a spec change that was
not regenerated cannot merge. External consumers get the SDK on the next
production release (see below); internal consumers never wait on npm.

## Production: tagging a release

Workflow: [`.github/workflows/release.yml`](.github/workflows/release.yml)
(`[Prod] Release`), triggered by pushing a tag matching `v*`.

A prod release deploys backend and frontend to prod, publishes the **stable**
(public) SDKs, and creates a GitHub Release.

The tag version must match the version recorded in the package files, so bump
the version first, then tag the resulting commit.

From the repository root:

```bash
# 1. Bump version across backend, frontend, discord, the SDK package and the spec
npm run release:set-version 1.2.3
npm run release:check-version 1.2.3

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
5. Dispatches the **stable** TypeScript SDK release ->
   https://github.com/BrigadaSOS/nadeshiko-sdk-ts regenerates from this
   release's spec and publishes `X.Y.Z` to npm. Publishing lives there because
   npm's trusted publisher (OIDC, no token) is bound to that repository.
6. Dispatches the **stable** Python SDK release -> public PyPI version.
7. Creates a GitHub Release with the public OpenAPI spec attached.

> **Not part of this workflow:** the root-path locale redirect is answered by
> Cloudflare, applied 2026-08-13 and managed as code in
> `brigadasos-infra/terraform/cloudflare-redirects.tf`. No deploy touches it, and
> no deploy is needed to change it. See
> [Cloudflare edge configuration](#cloudflare-edge-configuration).

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
`npm run db:bootstrap` with admin credentials. To run migrations manually
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

Production and staging share ONE Elasticsearch server
(`nadeshiko-backend-prod-elasticsearch`) with an index each -- `nadedb_prod` and
`nadedb_dev`. Two servers on a 7.7 GB host cost ~1 GB of RAM to serve two
indices, on a box already in swap. The isolation this gives up is real: a
destructive command aimed at staging reaches the production server, and only the
index names keep the data apart.

How production got from 8.19.15 to 9.4.1, with the site serving throughout, is in
[`backend/docs/elasticsearch-9-blue-green.md`](backend/docs/elasticsearch-9-blue-green.md).
The server is pinned to 9.4.1 because `analysis-sudachi`
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


### Recovering Elasticsearch

**The index is derived data. There is no Elasticsearch backup and none is
needed** — Postgres is the authoritative source and the index is rebuilt from
it. Recovery from a lost, corrupted or unopenable ES volume is a reindex, not a
restore:

Run it **inside the deployed backend container**, not from your machine — the
local `npm run es:*` scripts read your `.env` and would target your dev index:

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
the ES8 container and volume were retained through the observation window and
have since been removed, so recovery from a lost index is a reindex from
PostgreSQL (`remote-db.sh <env> reindex`). That is not a loss: the index is
derived data and PostgreSQL is authoritative.

`scripts/migrate-elasticsearch-production.sh` is gone with them. It could never
have run -- all 44 of its remote commands used `sudo -n`, and Kamal connects as
the `docker` user, which is in the `docker` group and NOT in `sudo`. Only a `v*`
tag invoked it, so nothing exercised it until v2.3.0, which failed on its first
remote command. Production releases are now a plain `kamal deploy`.

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

### Backup monitoring

[`.github/workflows/verify-backup.yml`](.github/workflows/verify-backup.yml) runs
daily at 03:30 UTC and fails — notifying Discord through the same workflow the
deploys use — if any expected database lacks a dump newer than 26 hours, or if a
dump comes in under 70% of the size of the run before it.

It checks the database **by name** (`nadeshiko-prod`). kartoza/pg-backup dumps
every database on the server unless `DBLIST` says otherwise, and staging shares
prod's Postgres — so the bucket used to receive two dumps a night and "the newest
`.dmp.gz`" landed on prod only because prod happened to dump second. `DBLIST` now
pins the accessory to prod, and naming the database in the check means a silent
revert to dumping everything, or prod dropping out, is itself a failure.

Staging is deliberately **not** backed up: it is disposable and can be reseeded
from prod. The `nadeshiko-dev` dumps that predate `DBLIST` were deleted from the
bucket.

Both conditions matter. Without the freshness check a broken cron is invisible,
and because retention prunes at 30 days the good backups age out while nobody is
looking: a silent failure that erases its own evidence. The size check exists
because a dump that breaks partway still uploads, and a truncated file is
indistinguishable from a healthy one if you only check that a backup exists. The
comparison is relative rather than a fixed floor: dumps sit around 1.2 GB and
move roughly 0.01% night to night, so a real truncation stands out, and the
threshold keeps working as the corpus grows.

This does **not** prove a dump restores. That needs a scratch database and the
runbook below; it is worth doing by hand periodically, since an unrestored
backup is a hypothesis.

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

## Deploy annotations (removed)

Each service's `.kamal/hooks/post-deploy` used to call
`scripts/grafana-annotate-deploy.sh`, posting a Grafana annotation so deploys
lined up against metrics. Hooks, script and secret lines are all gone.

It was removed because it broke production deploys. The token lived at
`/nadeshiko/shared/GRAFANA_ANNOTATION_TOKEN`; that parameter no longer exists in
any region, and `.kamal/ssm-secret` exits non-zero on a missing read, which under
`set -euo pipefail` aborts the entire secrets file. All three services --
backend, frontend and discord -- would have failed at secret resolution before
loading a single real credential. Nothing caught it because the reference
predates the currently deployed build and production has not been released
since.

The failure mode was written down right here, in the paragraph this one
replaces, as a warning about adding the secret to staging. It was accurate; it
just described the wrong environment in the end.

To bring annotations back: restore the token in SSM, re-add the secret line to
each service, and reinstate the hook -- but make the read non-fatal, because a
dashboard decoration must never be able to fail a deploy.

## Alerting and dashboards

**None of this is in this repo.** Monitoring config lives with the stack that
loads it, in `brigadasos-infra`:

| What | Where |
| --- | --- |
| Alert rules | `machines/monitoring/victoria/config/vmalert-rules/` |
| Scripts, dashboards, the detail | `machines/nadeshiko/monitoring/` |

Rules used to live here and were mounted by nothing — which reads like coverage
and is worse than an empty directory. Anything that only an infra deploy can
apply belongs next to that deploy, not next to the application.

vmalert runs and evaluates `*.yml` in that directory; everything except
`noop.yml` currently sits in `disabled/`, so nothing fires. Moving a file up one
level out of `disabled/` is the entire activation step — deliberately separate
from writing the rule, so enabling is a decision someone makes rather than a
side effect of authoring. Alertmanager on `monitoring:9093` has had a working
Discord receiver since June, so delivery is built and tested; what is missing is
anything enabled to send. Production backend telemetry stopped on 2026-07-24 and
was still missing twelve days later without anyone being told.

Before writing a rule, check what actually reports — this used to say "span
metrics only, and no logs", and both halves are now wrong.
`brigadasos-infra/machines/nadeshiko/monitoring/README.md` has the current
inventory: application metrics, span metrics, host and container metrics all
arrive via the Alloy edge collector, and VictoriaLogs *does* hold Nadeshiko
streams — in **tenant `1:0`**, which is why querying without the tenant header
makes them look absent. Two traps worth repeating: always filter host metrics on
`host_name="nadeshiko"` (the same instance holds other hosts' series), and check
a metric exists in *production* before alerting on it. Several custom counters
are emitted only by builds newer than what prod is running.

`machines/nadeshiko/monitoring/scripts/publish-host-metrics.sh` is the cheap way
around the first gap: a cron on the host publishing Elasticsearch health,
Postgres backup freshness and container restart counts, which is what the
`nadeshiko-host` rule group alerts on. Note it is **not installed** — it is in
no crontab and not present at `/usr/local/bin` on the host, so that rule group
would alert on data nothing produces. Install it before enabling those rules.

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

## Cloudflare edge configuration

`nadeshiko.co` is proxied by Cloudflare. Everything below is **dashboard/API
state, not code** — nothing in this repository applies it, so it survives no
deploy and is recreated by nobody. Treat it as part of the release checklist.

### The bare-path locale redirect

**Status: APPLIED 2026-08-13**, and managed as code — the rules live in
`brigadasos-infra/terraform/cloudflare-redirects.tf` with the matching `import`
block in `imports.tf`, not in the dashboard. Verified with the commands at the
end of this section: `/` answers `302` to `/en`, `/es` or `/ja` from the cookie
alone and carries no `x-request-id`, so it is the edge answering, not the origin.

Two things that bit on the way in, both preserved in comments there: the
resource must be `name = "default"` (any other name forces *replacement* of the
entry-point ruleset, which would drop the `www` → apex 301 with it), and the
`import` block must be uncommented in the same change, or the apply fails with
`exceeded maximum number of zone rulesets for phase`.

`/` is the first request of every cold visit and it carries no content. Answered
at the origin it is a full round trip to Helsinki for a zero-byte 302: measured
from Tokyo (2026-08-07) at **~1.2 s TTFB, against 10 ms p50 of actual origin
work** (`duration_ms` on `path="/"` in the kamal-proxy logs). Roughly 99% of that
is network the response never needed to cross. Answered at the edge it costs a
few tens of milliseconds.

Three **Single Redirect** rules, phase `http_request_dynamic_redirect`,
evaluated top-down (first match wins), each a 302 with *preserve query string*
on. All three share this condition:

```
http.host eq "nadeshiko.co"
  and http.request.uri.path eq "/"
  and http.request.method in {"GET" "HEAD"}
```

| # | Extra condition                                     | Redirect to                            |
| - | --------------------------------------------------- | -------------------------------------- |
| 1 | `and http.cookie contains "nd-locale-preference=es"` | `concat("https://", http.host, "/es")` |
| 2 | `and http.cookie contains "nd-locale-preference=ja"` | `concat("https://", http.host, "/ja")` |
| 3 | *(none — the default)*                              | `concat("https://", http.host, "/en")` |

There is deliberately no rule for `en`: it would share a target with the
default, so rule 3 covers it. Crawlers send no cookie and land on rule 3.

**The host test is not decoration.** Redirect Rules apply to the whole zone, and
this zone also carries `cdn.`, `t.`, `o.`, `api.` and `stg.nadeshiko.co`.
Without the host test these rules answer `https://cdn.nadeshiko.co/` with a 302
to `/en`, which is nonsense for a bucket. Any new hostname that should get the
locale redirect has to be added here explicitly.

**`www` is intentionally absent.** It already 301s to `https://nadeshiko.co/`,
so it reaches these rules on the second hop; listing it here would only race
that existing rule. `stg.nadeshiko.co` is also left out, so staging keeps
answering at its own origin and cannot disagree with prod while the two run
different builds.

**Test the cookie with `http.cookie contains "…"`**, against the raw Cookie
header as a string — *not* the documented-looking
`any(len(http.request.cookies["nd-locale-preference"][*]) > 0)`. The ruleset API
rejects that form outright (`cannot perform this operation on type Array`), so
do not "restore" it. Note `contains` is a substring test: a forged
`nd-locale-preference=espanol` matches rule 1 at the edge while the origin
resolves it to `/en`. It only affects whoever forged it.

### The origin half, and why the two agree

`resolveRootLocale` (`frontend/server/utils/localeRouting.ts`) is a pure function
of one input: the plain `nd-locale-preference` cookie, defaulting to `en`. That
is what makes the decision movable to the edge, and it is the whole reason the
rules above are three static lines instead of a generator.

It used to also infer from `Accept-Language`, weighing q-values. Cloudflare
cannot do that, so keeping it would have meant one decision with two
implementations answering the same request differently depending on who caught
it. The trade: a Spanish speaker's first visit starts in English and costs one
click on the language selector, which then remembers. That is also what Google
asks for — no automatic language redirection, offer a switcher.

**Do not add an input the edge cannot read** (stored settings, a session lookup,
`CF-IPCountry`, `Accept-Language`). Any of them forces `/` back to the origin and
the latency back with it. `frontend/server/utils/localeRouting.test.ts` pins the
resolver's argument count for exactly this reason, and the cases it asserts are
the ones the rules above mirror — if a change there makes them fail, the
Cloudflare rules have to change in the same breath.

Unprefixed deep links (`/about` -> `/en/about`) stay at the origin on purpose:
answering them at the edge would mean restating `isReservedLocalePath` as a
Cloudflare expression, in a second home that drifts silently. `/` is where the
first-visit cost actually is.

### Applying it

`PUT …/entrypoint` **replaces the whole ruleset**, and the `www` -> apex redirect
very likely lives in this same phase. Read it before writing, then PUT the merged
list:

```bash
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_request_dynamic_redirect/entrypoint" \
  -H "Authorization: Bearer $CF_TOKEN" | jq '.result.rules[] | {description, expression}'
```

Verify afterwards, allowing a few minutes for the edit to reach every PoP:

```bash
for c in '' 'nd-locale-preference=es' 'nd-locale-preference=ja' 'nd-locale-preference=de'; do
  curl -sI ${c:+--cookie "$c"} https://nadeshiko.co/ | grep -iE '^(location|x-request-id)'
done
# expected: /en, /es, /ja, /en — and no x-request-id, which would mean the
# origin answered
```

### Surviving a deploy with a page already open

**A deploy should be invisible to people mid-visit.** For a while it was not, and
`Failed to fetch dynamically imported module` in PostHog is what that looked like.

The cause is one fact about how the app ships. A rendered page names the
content-hashed `/_nuxt/*` chunks of the build that rendered it, and the container
holds exactly one build. The moment a new one is live, every page in existence
that predates it — a tab left open, HTML held at the edge, HTML in a reader's own
disk cache — asks for files the origin no longer has.

Four things address that, and only the first one actually removes the problem:

| Layer | What it does | Where |
| --- | --- | --- |
| **Asset archive** | keeps the previous builds' `/_nuxt/*` files servable, so the old page's requests still succeed | `frontend/server/plugins/03-asset-archive.ts` |
| Edge purge | stops the edge handing out HTML that names a build that is gone | `.kamal/hooks/post-deploy`, `release.yml` |
| `browser_ttl = respect_origin` | stops the reader's own cache pinning that HTML for an hour | `cloudflare-cache.tf` |
| Client reload | last resort, gets a reader onto the new build | `app/plugins/chunkReload.client.ts` |

The bottom three are races and only help the *next* navigation. The archive is
not a race: the reader's page keeps working because the file it asks for is still
there. Everything below it is what catches the cases the archive cannot — a
reader whose page is older than the retention window, or a build that changed
more than its chunks.

**The archive is a host volume, and it is the part that can be misconfigured
silently.** `/var/lib/nadeshiko/frontend-{prod,stg}/asset-archive`, mounted at
`/app/asset-archive` and named by `NUXT_ASSET_ARCHIVE_DIR`. It must exist and be
owned by uid 1000 before the first deploy — the startup pass deliberately refuses
to create it, because a container-local directory would work perfectly until the
container is replaced, which is the only moment any of this matters. Check it
took:

```bash
# on deploy: the two lines that say it is on
kamal app logs -d prod | grep 'asset archive'
#   asset archive: serving superseded builds   liveAssets=156 retentionDays=30
#   asset archive: publish complete            copied=12 pruned=0

# from outside: an old chunk still answers, and says where it came from
curl -sI https://nadeshiko.co/_nuxt/<a-chunk-from-the-previous-build>.js \
  | grep -iE '^HTTP|x-nd-asset'
#   HTTP/2 200
#   x-nd-asset: archive
```

**Retention is 30 days on prod, 7 on staging** (`NUXT_ASSET_ARCHIVE_DAYS`),
counted from the last build that still contained the file. The split is the
deploy rate: prod releases 5–12 times a month, staging on every push to main —
188 commits in the 30 days to 2026-08-13 — and nobody keeps a staging tab open
for a fortnight. The startup pass restamps every file the running build still
uses, so a chunk that survives unchanged for months is never pruned out from
under a live page.

**Sourcemaps are not archived**, which is what keeps the volume small. A build is
12.5MB, of which 10.6MB is `.map`; the archive holds the remaining 1.9MB of code
and styles. Nothing is lost, because `sourcemap: { client: 'hidden' }` emits maps
with no `sourceMappingURL` in the chunks — no browser has ever requested one, and
an old page cannot start. The maps that matter are uploaded to PostHog at build
time by `@posthog/nuxt` and are keyed by chunk id, not fetched from here. So the
worst case is bounded by deploy rate rather than by build size: ~23MB on prod,
~50MB on staging, against ~150MB and ~2.3GB if maps were kept.

`/_nuxt/builds/latest.json` is deliberately **not** covered: it is Nuxt's record
of which build is current, and serving a superseded copy of the file whose job is
to announce that the build changed is the one thing this must never do. It is
also the reason `/_nuxt/builds/**` carries `no-cache` in `routeRules` rather than
the year the surrounding `/_nuxt/**` rule gives everything else.

### Purging HTML on deploy

**Status: required, and wired into both deploy paths.** This section used to say
it was not applicable, on the grounds that no HTML was edge-cached. That stopped
being true on 2026-08-13, when `cache_anonymous_sentence_html` and
`cache_anonymous_search_html` went into `cloudflare-cache.tf` and the shared TTL
for those paths was raised to an hour.

| Deploy path | Purged by |
| --- | --- |
| Tagged release (`release.yml`) | the `Purge Cloudflare cache` step in `release-frontend` |
| `kamal deploy -d prod` by hand | `frontend/.kamal/hooks/post-deploy` |

The hook was added on 2026-08-13 because only the first of those was covered.
A manual prod deploy reported complete success and left the edge serving HTML
that named `/_nuxt/*` digests the new container did not have — the failure this
whole section exists to prevent, on the one path nobody had wired up.

Why it is not optional. Fingerprinted assets are safe to cache and are not the
problem: `/_nuxt/BRrCu_qM.js` is content-addressed, `immutable`, cached a year,
and a new build simply produces new filenames, so old and new coexist. **HTML is
the opposite.** `/en/search/猫` is a stable URL whose body names the digests of
the build that rendered it. Edge-cached for an hour, it outlives the deploy and
points at `/_nuxt/*.js` the new container does not have, and the reader gets
`Failed to fetch dynamically imported module`.

Worse, the client-side recovery in `app/plugins/chunkReload.client.ts` cannot
save them without this purge: the reload it triggers re-requests the page, the
edge serves the same stale HTML, and it burns both its attempts and reports
`app:chunk-error-unrecoverable`. The purge is what makes that path work.

The edge is only half of where that stale HTML lives, though — see the section
above. Until 2026-08-13 the reader's own browser was told to hold it for an hour
too, which no purge can reach, and the asset archive is what stops any of this
from reaching a reader in the first place.

Mechanics, and the two constraints that decide them:

- **Purge everything, not by URL.** Sentence and search URLs are unbounded, and
  purge by prefix, hostname or tag is Enterprise-only. Dropping `/v1/media/*`
  and the fingerprinted assets along with the HTML is harmless — they are
  immutable and refill from origin.
- **Prod only, because prod and staging share this zone.** Purging after a
  staging deploy would throw away production's entire edge cache. In CI that
  means the step lives in `release.yml` and not `staging-release.yml` — do not
  copy it there. In the hook it means the `KAMAL_DESTINATION != prod` guard,
  which is the single most important line in that file.

In CI it runs as the last step of `release-frontend`, after `kamal deploy`
(purging first would let the edge refill from the old container mid-swap) and
before `e2e`, so the prod E2E run tests a purged edge. Cloudflare answers `200`
with `"success": false` when the token lacks the permission, so both the step and
the hook check the body rather than the exit code.

The hook stands down when `GITHUB_ACTIONS` is set, so a tagged release purges
once rather than twice and does not gain a new way to fail. It also fires on
`rollback`, which changes which digests are live just as much as a deploy does.
Its token is read through `.kamal/ssm-secret` from
`/nadeshiko/prod/CLOUDFLARE_PURGE_TOKEN` — a separate, Cache-Purge-only token
from the CI one, minted the same way. Note that **writing** that parameter needs
the `nadeshiko-admin` profile; `nadeshiko-prod` can read SSM but not write it.

CI needs two repository secrets, both already set:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_ZONE_ID` | the `nadeshiko.co` zone id |
| `CLOUDFLARE_PURGE_TOKEN` | an API token whose only policy is **Cache Purge** on that one zone |

**Not** `CLOUDFLARE_API_TOKEN`. That name is already an organization secret used
by `refresh-seed-dump.yml` for R2, and a repository secret of the same name
would shadow it for this repo and break that workflow. The purge token is also
deliberately separate rather than reusing the broad Terraform token from
`/brigadasos-infra/terraform/cloudflare_api_token` in SSM: anything readable by
Actions is readable by anyone who can land a workflow, so it holds the narrowest
permission that does the job. It was minted from the Terraform token via the
Cloudflare API and can be re-minted the same way.

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

Two things a manual deploy does differently, both worth knowing before you rely
on one:

- **The edge cache purge is handled** by `frontend/.kamal/hooks/post-deploy`
  (see [Purging HTML on deploy](#purging-html-on-deploy)). It was not, before
  2026-08-13.
- **Nothing records what shipped.** There is no tag, no GitHub Release and no
  version bump, so `release:check-version`, the `v*` tags and
  `OTEL_SERVICE_VERSION` all keep describing the last tagged release while prod
  runs something newer. Commit and push first so the image is at least tagged
  with a revision that exists on `main` — Kamal otherwise stamps the image
  `<sha>_uncommitted_<digest>`, which nobody can trace back. Reconcile with a
  bump-and-tag release when convenient.

After a **frontend prod** deploy, check
[Cloudflare edge configuration](#cloudflare-edge-configuration) — it lists zone
state that no deploy applies and that is currently outstanding.
