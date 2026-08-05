# Seed Worker

Cloudflare Worker that serves the seed database dump from a private R2 bucket, gated by a shared token.

## Setup

```bash
cd infra/seed-worker
npm install   # from the repository root
```

## Deploy

```bash
# Set the shared download token
npx wrangler secret put SEED_TOKEN

# Deploy the worker
npm run deploy
```

## Refreshing the seed dump

`scripts/refresh-seed-dump.sh` dumps the production database over the existing
SSH/Tailscale path, verifies the result, and uploads it:

```bash
# Verify without publishing
infra/seed-worker/scripts/refresh-seed-dump.sh --no-upload

# Publish (needs CLOUDFLARE_API_TOKEN scoped to R2 write, plus CLOUDFLARE_ACCOUNT_ID)
infra/seed-worker/scripts/refresh-seed-dump.sh
```

The same script runs from the `[Infra] Refresh seed dump` workflow, which is
manual-dispatch-only and defaults to a dry run. Its monthly schedule is
commented out until a few hand-run cycles prove it out.

### It dumps an allowlist, not the database

Anyone with `SEED_TOKEN` can download this file, and it comes from production.
The script dumps only the content tables — media, episodes, segments,
characters, series — and refuses to publish if the resulting archive contains
anything else. Users, sessions, OAuth accounts and API keys are never in it.

The list mirrors `SEED_CONTENT_TABLES` in `backend/bin/setup.ts`, which restores
data-only through its own allowlist. Both sides filter; change them together.

The dump is data-only in practice: contributors get their schema from
migrations, and `bin/setup.ts` re-runs the base seeds afterwards so the local
admin user and API key match their own `.env`.

### Doing it by hand from a local database

```bash
docker exec nadeshiko-postgres pg_dump -U admin -d nadedb \
  --format=custom --no-owner --no-privileges \
  --table='public."Media"' --table='public."Episode"' --table='public."Segment"' \
  --table='public."Character"' --table='public."Seiyuu"' --table='public."MediaCharacter"' \
  --table='public."MediaExternalId"' --table='public."Series"' --table='public."SeriesMedia"' \
  -f /tmp/seed.dump
docker cp nadeshiko-postgres:/tmp/seed.dump ./seed.dump

npx wrangler r2 object put nadeshiko-seed/seed.dump --file ./seed.dump --remote
```
