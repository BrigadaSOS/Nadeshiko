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
