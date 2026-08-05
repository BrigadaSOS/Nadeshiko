# Contributing to Nadeshiko

Thanks for your interest in contributing to Nadeshiko! This guide will help you get the project running locally and explain how we work together.

## Prerequisites

- [Bun](https://bun.sh/)
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose

## Getting started

```bash
# Clone the repository
git clone https://github.com/BrigadaSOS/Nadeshiko.git
cd Nadeshiko

# Install dependencies
bun install --cwd backend
bun install --cwd frontend

# Run the setup (creates .env files, starts Docker containers, runs migrations and seeds)
bun run setup
```

The setup script will:

1. Create `.env` files from `.env.example` for both backend and frontend.
2. Start PostgreSQL and Elasticsearch containers via Docker Compose.
3. Bootstrap the database, run migrations, and seed initial data.
4. Optionally download a seed database with sample content (requires a token from a project admin).

> Important: If you want to debug or develop any feature related to actual content, ask the Nadeshiko admins in the discord server for a token that can be used to download a backup of the dev table. This has to be provided during the setup script above. Otherwise, the database will be completely empty after setup.

Once setup is complete, start both servers:

```bash
bun run dev
```

Or run them individually:

```bash
bun run dev:backend    # API on http://localhost:5000
bun run dev:frontend   # App on http://localhost:3000
```

`bun run dev` runs both in one shell and tears them down together on Ctrl-C. It
does not fail fast: if one server dies the other keeps running, so watch the
output for a process that has dropped out.

On macOS, the AirPlay Receiver listens on port 5000 and the backend will fail to
bind. Either turn it off under System Settings → General → AirDrop & Handoff, or
set `PORT=5050` in `backend/.env` and point the frontend at it with
`NUXT_BACKEND_INTERNAL_URL=http://localhost:5050` in `frontend/.env`.

## Commands

Backend-specific (run from `backend/`):

```bash
bun run dev            # Start the API server in dev mode
bun run test           # Run tests
bun run generate:all   # Regenerate OpenAPI types, Zod schemas, and route types
bun run db:migrate     # Run pending migrations
bun run db:seed        # Re-run seeds
bun run db:rollback    # Rollback last migration
bun run es:reindex     # Reindex Elasticsearch
```

Frontend-specific (run from `frontend/`):

```bash
bun run dev            # Start the Nuxt dev server
bun run build          # Build for production
```

## Keeping the local Elasticsearch image current

The Elasticsearch container is built locally from `backend/docker/Dockerfile.elasticsearch`
(the stock image plus the ICU and Sudachi analysis plugins). Docker never rebuilds
a locally built image on its own, so when someone bumps the pinned version your
machine keeps running the old one until you rebuild it yourself — a stack can sit
several versions behind without any visible symptom.

`bun run setup` now compares the version baked into your image against the one
the Dockerfile pins and tells you when they have drifted. To rebuild:

```bash
cd backend
docker compose build elasticsearch
docker compose up -d elasticsearch
```

**Across a major version you also have to discard the data volume.** Elasticsearch
refuses to open a data directory written by an older major (it asks you to upgrade
through the intervening version first), so the container will just fail to start.
The local index is derived data — Postgres is the source of truth — so throwing it
away is safe:

```bash
cd backend
docker compose down elasticsearch
docker volume rm backend_nadeshiko_elasticsearch_data
docker compose up -d elasticsearch
bun run es:reindex
```

If Elasticsearch fails to start for some other reason, `bun run setup` prints the
tail of the container log rather than just timing out.

## Project structure

```
backend/               Bun + Express + TypeScript API
  bin/                 CLI scripts (setup, db, es)
  app/                 Application code (controllers, services, entities)
  db/                  Migrations and seeds
  docs/openapi/        OpenAPI schema definitions
  generated/           Auto-generated types (do not edit)

frontend/              Nuxt 4 + Vue 3 app
  app/                 Pages, components, composables
  i18n/                Translations (en, es, ja)

infra/                 Infrastructure tooling
```

## Reporting issues

Open an issue on [GitHub](https://github.com/BrigadaSOS/Nadeshiko/issues). For questions, feature ideas, or general discussion, join the [Nadeshiko Discord](https://discord.gg/c6yGwbXruq).

If you see a bug and want to provide a fix for it, you are free to just open a pull request directly. But for features or improvements, we encourage to first add an Issue or ask in the Discord server so we can align on the solution before working on any code changes.

## Submitting changes

1. Fork the repository and create a branch from `main`.
2. Make your changes and make sure `bun run lint` and `bun run build` pass.
3. Open a pull request against `main` with a clear description of what you changed and why.
