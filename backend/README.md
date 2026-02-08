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

- Copy `.env.example` to `.env` if needed
- Initialize the database with default admin user

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
`config/deploy.prod.yml`. Manage accessory lifecycle with the `prod` destination.

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
