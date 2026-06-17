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

Each deploy starts a fresh container; on boot the database initializer connects
and runs any pending TypeORM migrations (as the app DB role, before workers
start) before the container becomes healthy. If a migration fails, the new
container fails its health check and Kamal keeps the previous one serving, so a
bad migration fails the deploy instead of shipping a broken app.

This covers applying migrations to an already-provisioned database. Creating a
brand-new environment (role, database, grants) is still a one-time
`bun run db:bootstrap` with admin credentials. To run migrations manually
out of band, use `scripts/remote-db.sh <env> migrate`.

## Manual / emergency deploys

The staging workflow supports `workflow_dispatch` with `force_backend` /
`force_frontend` inputs, so you can redeploy stg from the Actions tab without a
code change.

To deploy from your own machine you need Tailscale access to the `nadeshiko`
host, Kamal installed, and the destination secrets. Then from the relevant app
directory:

```bash
cd backend   # or frontend / discord
kamal deploy -d staging   # or -d prod
```

Prefer the workflows; reach for a manual deploy only when CI is unavailable.
