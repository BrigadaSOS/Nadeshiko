# Run Nadeshiko with Parcela

`parcela up` runs a whole Nadeshiko environment for one checkout: PostgreSQL and Elasticsearch from `backend/docker-compose.yaml`, and the native backend and frontend. Every jj workspace or Git worktree gets its own containers, volumes, ports and URLs, so several can run at once without sharing data. The Compose file and the npm launchers work as before without Parcela.

## Prerequisites

- Parcela 0.5.1 or newer.
- Docker with Compose 2.24.4 or newer.
- Node.js 24 or newer.
- `backend/.env` and `frontend/.env` in the main checkout. A new worktree copies them from there.

## Start

```sh
parcela up            # from anywhere in the checkout
parcela up --detach   # return once everything is ready
```

The main checkout is at `https://nadeshiko.localhost` with its API at `https://api-nadeshiko.localhost`. A worktree named `search` is at `https://search-nadeshiko.localhost` and `https://api-search-nadeshiko.localhost`. With Parcela's proxy on another port, the URLs carry it, like `:1443`.

`up` does this:

1. Starts `postgres` and `elasticsearch` from `backend/docker-compose.yaml` in the Compose project `nadeshiko-<environment>`, on loopback ports Parcela leases, and waits until both are healthy. Compose reads the container passwords from the main checkout's `backend/.env`. The first run builds the `nadeshiko-elasticsearch:local` image, which every worktree then shares.
2. On the environment's first `up`, runs `hooks.setup`: copies both `.env` files, runs `npm ci` if there is no `node_modules`, then `db:prepare` and `db:seed`. On every `up`, runs `db:prepare`, which creates the role and database, applies pending migrations and sets up pg-boss and the Elasticsearch user, role and index alias. All of these can run again safely.
3. Starts the backend and then the frontend, and routes them once `/up` answers.

`parcela.yaml` points the backend at the environment's containers through `POSTGRES_*` and `ELASTICSEARCH_HOST`, which take precedence over `backend/.env`. The frontend calls the backend directly on its loopback port.

Hooks and tasks get `COMPOSE_PROJECT_NAME` and `COMPOSE_FILE`, so a `docker compose` they run reaches the environment's own containers from any directory. From your shell, name the project: `docker compose -p nadeshiko-primary exec postgres psql`, from `backend/`.

## Stop

```sh
parcela down
```

`down` stops the frontend and backend, then the environment's containers, and keeps the volumes. If Docker is not running, `down` says so and the environment stays interrupted until `parcela down` succeeds.

Nothing deletes an environment's data. `parcela rm` removes a stopped environment's containers and network and lists its volumes, to delete with `docker volume rm`.

## Seed content

`db:seed` creates the admin user, the master API key and the E2E users. The content dump from `npm run setup` is not part of `up`. It needs a token and a network download, and it cannot be restored twice into the same database.

## Tasks

```sh
parcela task validate              # Parcela, backend and frontend tests
parcela task validate -- backend   # one suite: parcela, backend or frontend
parcela task generate-api
parcela task sdk-sync
```

`validate` runs against the environment's own containers and needs the environment to be running. Before the backend tests, it drops and recreates the test database `nadeshiko_test`, the test Elasticsearch user and the `nadedb_test` index there, with `npm run test:setup`.

## Limits

- Each running environment has its own Elasticsearch with a 1 GB heap.
- A worktree uses the main checkout's `.env` files and secrets, including external service credentials.
- `node --test scripts/parcela.test.mjs` covers the test environment and configuration. The full flow is checked by running it.
