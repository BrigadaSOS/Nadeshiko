# Nadeshiko API

## API Quick Start

The Nadeshiko API lets you search Japanese segments (subtitles with translations) across anime, J-Drama, and audiobooks.

**Base URL:** `https://api.nadeshiko.co`

Authenticate with a Bearer token in the `Authorization` header. Generate an API key at [nadeshiko.co/settings/api](https://nadeshiko.co/settings/api).

```ts
const res = await fetch("https://api.nadeshiko.co/v1/search/segments", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer YOUR_API_KEY",
  },
  body: JSON.stringify({
    query: "彼女",
    limit: 5,
  }),
});
```

Supports romaji, kanji, kana, English, and Spanish queries. Use `exactMatch: true` for phrase matching, and filter by `category`, `minLength`, `maxLength`, `contentSort`, and more.

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

### Running the Application

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

Shared accessories (`postgres`, `elasticsearch`, `grafana`, etc.) are defined only
in `config/deploy.prod.yml`. Manage accessory lifecycle with the `prod` destination.

## Bruno Collection

Import and use the [Bruno](https://www.usebruno.com/) collection from
`/docs/bruno` for easy testing of the API endpoints.

## OpenAPI Diffing

Use `oasdiff` to check breaking changes and generate a changelog for the public API contract.
The backend scripts compare your working copy against a git ref, defaulting to `origin/main`.
If you want release notes for what is currently in production, point `--from` at the tag that
matches the deployed backend release.

Install `oasdiff` first, then run:

```bash
bun run openapi:breaking -- --from origin/main
bun run openapi:changelog -- --from v2.1.0 --output docs/generated/openapi-changelog.md
```

Notes:

- These commands compare the bundled `public` spec by default, so `x-internal` endpoints are excluded.
- Use `origin/main` when you want pre-merge compatibility checks, and a release tag when you want a prod-facing changelog.
- Pass `--visibility internal` if you want to diff the full internal contract instead.
- Pass `--format json`, `--format yaml`, or another `oasdiff` format when you need machine-readable output.
