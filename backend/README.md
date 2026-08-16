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

- Node.js 24 (npm ships with it)
- Docker and Docker Compose

### Quick Start

Start local dependencies:

```bash
docker compose up -d
```

Then, run the setup script to configure everything else. This is an npm
workspaces monorepo, so dependencies install once from the repository root:

```bash
npm install          # from the repository root
npm run setup        # from backend/
```

This will:

- In local, copy `.env.example` to `.env` if needed
- Recreate the database
- Reset Elasticsearch index mappings
- Run migrations and seed data

### Running the Application

For development (hot reloading):

```bash
npm run dev
```

For production:

```bash
npm run build
npm run start
```

The API will be available at `http://localhost:5000`

## Deployment (Kamal)

Run Kamal from the `backend` directory.

Secret files:

- `dev`: `.kamal/dev.key`
- `prod`: `.kamal/prod.key`

Development:

```bash
kamal deploy -d staging
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
npm run openapi:breaking -- --from origin/main
npm run openapi:changelog -- --from v2.1.0 --output docs/generated/openapi-changelog.md
```

Notes:

- These commands compare the bundled `public` spec by default, so `x-internal` endpoints are excluded.
- Use `origin/main` when you want pre-merge compatibility checks, and a release tag when you want a prod-facing changelog.
- Pass `--visibility internal` if you want to diff the full internal contract instead.
- Pass `--format json`, `--format yaml`, or another `oasdiff` format when you need machine-readable output.

## Access log fields

The HTTP access log carries `http.method`, `http.route`, `http.status_code`,
`http.request_id`, `http.user_agent`, `http.client_ip`, `http.client_country`,
`responseTime`, `traffic`, `trace_id` and `span_id` on every request, plus two
fields that identify the caller when there is one.

| Field | Present when | What it is |
| --- | --- | --- |
| `user.hash` | authenticated **and** `LOG_USER_SALT` is set | A salted SHA-256 of the account id, truncated to 16 hex chars. Stable per account for as long as the salt is, so log lines can be joined on it. |
| `apikey.id` | the call used an API key | better-auth's key id. Already non-identifying, and it is what tells a busy account apart from one integration stuck in a retry loop. |

Together these answer the question the request log could not before: *what has
this account been calling this week, and on which routes*. It used to be
answerable only from `AccountQuotaUsage`, which stores one integer a month and
cannot say what the calls were.

```
nd-logs query 'http.route:"/v1/search" user.hash:"a1b2c3d4e5f60718"' start=… end=…
```

**Do not put an unhashed user id, an email, or a username on the request line.**
An access log is a much wider dataset than the database — shipped off-box,
retained on its own schedule, read by anyone debugging anything — and a hash of
an email is not anonymous, because the input space is a mailing list. A join key
is all the log needs; the identity behind it stays in Postgres.

`LOG_USER_SALT` is a deployment secret. Left unset the field is simply absent,
which is deliberate: an unsalted digest of a small consecutive integer is a
lookup table anyone can build in a second, so the choice is a salted field or
none. Rotating the salt invalidates every prior join — that is the intended
lever for retiring the ability to ask about older lines, and it leaves those
lines fine for aggregate questions.
