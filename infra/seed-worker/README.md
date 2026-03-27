# Seed Worker

Cloudflare Worker that serves the seed database dump from a private R2 bucket, gated by a shared token.

## Setup

```bash
cd infra/seed-worker
bun install
```

## Deploy

```bash
# Set the shared download token
bunx wrangler secret put SEED_TOKEN

# Deploy the worker
bun run deploy
```

## Upload a seed dump

Export the local database and upload it:

```bash
# Dump from local Docker Postgres
docker exec nadeshiko-postgres pg_dump -U admin -d nadedb --format=custom --no-owner --no-privileges -f /tmp/seed.dump
docker cp nadeshiko-postgres:/tmp/seed.dump ./seed.dump

# Upload to R2
bunx wrangler r2 object put nadeshiko-seed/seed.dump --file ./seed.dump
```
