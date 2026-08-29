# Contributing to Nadeshiko

Thanks for your interest in contributing to Nadeshiko! This guide will help you get the project running locally and explain how we work together.

## Prerequisites

- [Node.js 24+](https://nodejs.org/) (npm ships with it)
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose

## Getting started

```bash
# Clone the repository
git clone https://github.com/BrigadaSOS/Nadeshiko.git
cd Nadeshiko

# Install dependencies for every workspace with a single install at the root
npm install

# Run the setup (creates .env files, starts Docker containers, runs migrations and seeds)
npm run setup
```

The setup script will:

1. Create `.env` files from `.env.example` for both backend and frontend.
2. Start PostgreSQL and Elasticsearch containers via Docker Compose.
3. Bootstrap the database, run migrations, and seed initial data.
4. Optionally download a seed database with sample content (requires a token from a project admin).

> Important: If you want to debug or develop any feature related to actual content, ask the Nadeshiko admins in the discord server for a token that can be used to download a backup of the dev table. This has to be provided during the setup script above. Otherwise, the database will be completely empty after setup.

Once setup is complete, start both servers:

```bash
npm run dev
```

Or run them individually:

```bash
npm run dev:backend    # API on http://localhost:5000
npm run dev:frontend   # App on http://localhost:3000
```

`npm run dev` serves each workspace package at a stable `https://<name>.localhost`
through a local reverse proxy ([portless](https://portless.sh)), so there is no
port to remember and no port to collide with. It asks for sudo once, to bind 443,
and Ctrl-C takes everything down together.

Worth it beyond taste: the frontend and backend stop sharing an origin, so their
cookies and local storage stop overwriting each other, and the AirPlay collision
below stops mattering.

```bash
npm run dev:ports
```

runs them on bare ports instead, for a machine where binding 443 is not on offer.
It does not fail fast: if one server dies the other keeps running, so watch the
output for a process that has dropped out.

On macOS, the AirPlay Receiver listens on port 5000 and the backend will fail to
bind. Either turn it off under System Settings → General → AirDrop & Handoff, or
set `PORT=5050` in `backend/.env` and point the frontend at it with
`NUXT_BACKEND_INTERNAL_URL=http://localhost:5050` in `frontend/.env`.

## Commands

From the repository root — these mirror the gates in
`.github/workflows/checks.yml`, so passing them locally means passing CI:

```bash
npm run lint          # Biome, redocly and locale parity across every workspace
npm run typecheck     # Backend, frontend, discord, SDK and seed worker
npm run test          # Backend, frontend, discord and SDK suites
npm run test:coverage # The same suites under coverage, gated (see below)
```

### Coverage

CI runs the backend, frontend and discord suites under `--coverage` and fails
when a workspace drops below the thresholds in its `vitest.config.ts`.

| Workspace | Lines | Gate | Room before it fails |
| --- | --- | --- | --- |
| backend | 81.8% | 80% | ~128 lines |
| discord | 42.5% | 39% | ~95 lines |
| frontend (everything) | 17.7% | 16% | ~1100 lines |
| frontend (`**/*.ts` only) | 38.1% | 36% | ~130 lines |

**Every one of these counts all source, not just the files a test imports.**
That distinction is the difference between a real number and a flattering one.
Left to itself vitest reports only modules some test already loaded, so a file
nobody tests is not 0% covered -- it is absent from the denominator entirely,
and the percentage silently means "of the code we touch". Each config therefore
sets an explicit `include`. It is worth knowing how much that moved things:
backend barely budged, 83.3% -> 81.8%, because its tests genuinely reach almost
everything. Discord went 58% -> 42%. The frontend went 74% -> 38%.

The frontend has two gates because one number cannot say both things. The global
figure includes `.vue` and is low because the component layer is barely tested
(0.4%); it is the honest headline and the one that should climb. The group gate
on `**/*.ts` holds the line on the layer that is actually tested, which would
otherwise be swamped -- 10k untested component lines drown any movement in the
TypeScript beneath them.

Thresholds are a **ratchet, not a target**: each sits a point or two under what
the suite measures, enough to absorb a change's worth of new code without
tripping, and no more. The gate is on the workspace total, not per file: adding
one untested file does not fail CI by itself, adding more untested code than the
margin does. Raising a number is a deliberate edit, and worth doing whenever you
push a workspace clear of its line.

The SDK is deliberately not covered -- it is generated client code, so the
figure would measure the generator rather than anything a person wrote.

`npm run test:coverage --workspace <name>` writes an HTML report to
`<workspace>/coverage/index.html`, which is how you find the uncovered lines.
The directory is gitignored.

### Component tests

`frontend/vitest.config.ts` loads `@vitejs/plugin-vue`, so a test can import an
SFC directly. The default environment stays `node` -- the ~1000 non-component
tests should not pay for a DOM they never touch -- so a component test opts in
with a docblock on line one:

```ts
// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import BlogPagination from './BlogPagination.vue';
```

`app/components/blog/BlogPagination.test.ts` is the worked example: it stubs
`NuxtLink` as a plain anchor so `to` reads as `href`, and mocks `$t` to return
the key so a copy change never breaks a structural assertion.

Backend-specific (run from `backend/`):

```bash
npm run dev            # Start the API server in dev mode
npm run test           # Run tests
npm run typecheck      # Typecheck the app (this is what CI enforces)
npm run typecheck:tests # Typecheck the test tree too — see the note below
npm run generate:all   # Regenerate OpenAPI types, Zod schemas, and route types
npm run db:migrate     # Run pending migrations
npm run db:seed        # Re-run seeds
npm run db:rollback    # Rollback last migration
npm run es:reindex     # Reindex Elasticsearch
```

`npm run typecheck` covers the app (`typecheck:app`) *and* the test tree
(`typecheck:tests`), and CI runs it. Keep it that way: for a long time the test
tree was excluded, and the gap let real breakage through — a helper calling an
unimported symbol, a `spyOn` left over from the bun-to-vitest migration, and
fixtures built against shapes the DTOs had since renamed. None of it failed a
test; it was simply invisible.

Frontend-specific (run from `frontend/`):

```bash
npm run dev            # Start the Nuxt dev server
npm run build          # Build for production
```

## Keeping the local Elasticsearch image current

The Elasticsearch container is built locally from `backend/docker/Dockerfile.elasticsearch`
(the stock image plus the ICU and Sudachi analysis plugins). Docker never rebuilds
a locally built image on its own, so when someone bumps the pinned version your
machine keeps running the old one until you rebuild it yourself — a stack can sit
several versions behind without any visible symptom.

`npm run setup` now compares the version baked into your image against the one
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
npm run es:reindex
```

If Elasticsearch fails to start for some other reason, `npm run setup` prints the
tail of the container log rather than just timing out.

## Project structure

This is an npm workspaces monorepo: one `npm install` at the root installs
every package, and the packages reference each other directly rather than
through published versions.

```
backend/               Node + Express + TypeScript API
  bin/                 CLI scripts (setup, db, es)
  app/                 Application code (controllers, services, entities)
  db/                  Migrations and seeds
  docs/openapi/        OpenAPI schema definitions
  generated/           Auto-generated types (do not edit)

frontend/              Nuxt 4 + Vue 3 app
  app/                 Pages, components, composables
  i18n/                Translations (en, es, ja)

discord/               Discord bot

packages/
  nadeshiko-sdk/       TypeScript SDK, generated from the OpenAPI spec.
                       Consumed by frontend and discord as a workspace
                       dependency; published to npm on release.

infra/                 Infrastructure tooling
  seed-worker/         Cloudflare Worker serving the seed database
```

### Changing the API

The SDK is generated, so a contract change is one commit rather than a
publish-and-bump cycle:

```bash
# after editing backend/docs/openapi/**
npm run generate:api --workspace backend   # server types, route auth, proxy allowlist
npm run generate:auth-spec --workspace backend # SDK-only bundle, including auth routes
npm run sdk:codegen                        # packages/nadeshiko-sdk
```

Commit the regenerated `generated/` directories with your change — CI fails if
they are stale, and never hand-edit generated files.

### Where the published SDK comes from

`packages/nadeshiko-sdk` is what the frontend and the bot import. The npm
package that external users install is built separately by
[nadeshiko-sdk-ts](https://github.com/BrigadaSOS/nadeshiko-sdk-ts), which
regenerates from the released OpenAPI spec when a production release dispatches
it.

Both therefore carry a copy of the generator and the hand-written helpers
(`src/paginate.ts`, `src/retry.ts`). A change to those files only reaches
internal consumers until the same change is made in the SDK repo, so anything
that must reach npm users needs applying in both places. Consolidating the two
copies is a known follow-up.

## Changelog

`/changelog` is a page readers visit, not a commit log. It lives in
`frontend/content/en/changelog.md` and is linked from the version in the footer.

Write the entry as part of the change that ships it, under `## Unreleased`, not
at release time from the git history. The hard part of an entry is naming what a
person actually saw, and that is exactly what evaporates: three weeks later a
commit reads "apply exclusions globally" and nobody can recover from it that a
`-word` search was still returning lines that matched the translation. Cutting a
release is then a rename: `## Unreleased` becomes `## x.y.z (YYYY-MM-DD)`.

The shape is one sentence, place first and in bold, taken from the site's own
vocabulary (Search, Sentence, Media, Anki, Account, Settings, Discord bot, API):

```markdown
### Fixes

- **Search**: a word you exclude with a leading dash is now excluded from every
  language a sentence is matched in.
```

Fixes go under `### Fixes`, new things under `### Highlights`. What does not go
on the page: anything still behind a lab or a flag, work with no surface a reader
could have noticed (refactors, CI, dependency bumps), and vague filler like
"various improvements". If it cannot be named, leave it out and the page stays
short, which is fine.

## Reporting issues

Open an issue on [GitHub](https://github.com/BrigadaSOS/Nadeshiko/issues). For questions, feature ideas, or general discussion, join the [Nadeshiko Discord](https://discord.gg/qRak9MprUS).

If you see a bug and want to provide a fix for it, you are free to just open a pull request directly. But for features or improvements, we encourage to first add an Issue or ask in the Discord server so we can align on the solution before working on any code changes.

## Submitting changes

1. Fork the repository and create a branch from `main`.
2. Make your changes and make sure `npm run lint`, `npm run typecheck` and
   `npm run test` pass from the repository root. `./scripts/pre-push` runs the
   same set minus the suites that need Postgres and Elasticsearch.
3. Open a pull request against `main` with a clear description of what you changed and why.
