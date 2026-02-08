# NadeDB Backend

## Development Setup

### Prerequisites

- bun
- Docker and Docker Compose

### Quick Start

Start local dependencies:

```bash
docker compose up -d
```

Then, run the setup script to configure everything else:

```bash
bun install
bun run setup
```

This will:

- In local, copy `.env.example` to `.env` if needed
- Recreate the database
- Reset Elasticsearch index mappings
- Run migrations and seed data

## Running the Application

For development (hot reloading):

```bash
bun run dev
```

For production:

```bash
bun run build
bun run start
```

The API will be available at `http://localhost:5000`

## Deployment (Kamal)

Run Kamal from the `backend` directory.

Secret files:

- `dev`: `.kamal/dev.key`
- `prod`: `.kamal/prod.key`

Development:

```bash
kamal deploy -d dev
```

Production:

```bash
kamal deploy -d prod
```

Shared accessories (`postgres`, `elasticsearch`, `grafana`, etc.) are defined only in
`config/deploy.prod.yaml`. Manage accessory lifecycle with the `prod` destination.

### Shared PostgreSQL + Isolated Users (dev/prod)

Use these secret groups:

- `POSTGRES_*`: app runtime user/database for each destination
- `POSTGRES_ADMIN_*`: shared admin/bootstrap account on the same PostgreSQL instance

First setup for each destination (destructive):

```bash
# dev app user/database
kamal app exec -d dev --reuse "bun run db:setup"

# prod app user/database
kamal app exec -d prod --reuse "bun run db:setup --allow-prod-destructive"
```

Normal deploy flow (non-destructive, idempotent):

```bash
kamal app exec -d dev --reuse "bun run db:prepare"
kamal app exec -d prod --reuse "bun run db:prepare"
```

`db:prepare` runs pending migrations only, and ensures pg-boss + Elasticsearch role/index setup without dropping data.

`db:setup` is destructive: it recreates the app PostgreSQL role/database and Elasticsearch app role/user/index before migrating + seeding.

### Elasticsearch Admin vs App Credentials

- `ELASTICSEARCH_ADMIN_*` is used for bootstrap operations (create index-scoped role/user/index).
- `ELASTICSEARCH_USER` / `ELASTICSEARCH_PASSWORD` is the app runtime credential.

Useful Elasticsearch commands:

```bash
kamal app exec -d dev --reuse "bun run es:status"
kamal app exec -d prod --reuse "bun run es:status"
```

`es:reindex` is destructive (resets index then repopulates from DB). In prod, pass `--allow-prod-destructive`.

## Destructive Commands in Prod

The following commands are blocked in `ENVIRONMENT=prod` unless you pass `--allow-prod-destructive`:

- `db:setup`
- `db:reset`
- `db:drop`
- `db:rollback`
- `es:reindex`

## Quality Checks
```bash
bun run lint
bun run typecheck
bun run build
bun run test:smoke
```

## Bruno Collection

Import and use the [Bruno](https://www.usebruno.com/) collection from
`/docs/bruno` for easy testing of the API endpoints.

## Release Versioning

Use a single command from the repository root to keep backend, frontend, and OpenAPI versions aligned:

```bash
bun run release:set-version 1.2.3
bun run release:check-version
```

Tag and push the backend release (this triggers the release workflow):

```bash
git tag -a v1.2.3 -m "Backend v1.2.3"
git push origin v1.2.3
```
