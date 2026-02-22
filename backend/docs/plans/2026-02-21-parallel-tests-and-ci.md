# Parallel Test Isolation + CI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace the shared module-level `QueryRunner` with `AsyncLocalStorage` scoping so tests within the same file can run concurrently, then add a GitHub Actions CI workflow that runs the full test suite against a Postgres service container.

**Architecture:** `test.extend` auto-fixture replaces `beforeEach`/`afterEach` transaction management. `AsyncLocalStorage<QueryRunner>` gives each concurrent test its own runner without module-level mutation. `TestDataSource.createQueryRunner` is patched once in `beforeAll` to read from the store. Test files import `it` (and `describe`, `expect`, `beforeEach`) from `../helpers/setup` instead of `vitest` directly. GitHub Actions uses a `postgres:16` service container and runs TypeORM migrations before the test suite.

**Tech Stack:** Bun, Vitest `test.extend`, Node.js `AsyncLocalStorage`, TypeORM, GitHub Actions service containers.

**Note on enabling concurrent:** The infrastructure built here makes concurrent tests safe at the DB level. Enabling `describe.concurrent` in existing test files also requires that no module-level mutable state is shared between tests (e.g. `let fixtures` or a shared `app` instance set differently per test). Current tests all use the same user (`kevin`) so the shared `app` is low-risk for now. New tests going forward should avoid module-level mutable state to be safe for concurrent execution.

---

### Task 1: Refactor setup.ts — AsyncLocalStorage + test.extend

**Files:**
- Modify: `tests/helpers/setup.ts`

Replace the module-level `testQueryRunner` variable and the `beforeEach`/`afterEach` hooks that manage it with an `AsyncLocalStorage`-backed auto fixture.

**Step 1: Replace the entire file content**

```typescript
/**
 * Integration test setup — real database, real HTTP stack, no mocks.
 *
 * Follows the Rails/37signals philosophy: test against the real database
 * with transaction-wrapped isolation. Each test runs inside a transaction
 * that gets rolled back — no truncation, no deadlocks, instant cleanup.
 *
 * Uses AsyncLocalStorage to scope each test's QueryRunner to its async
 * context, enabling within-file concurrent tests via it.concurrent /
 * describe.concurrent without shared mutable state.
 *
 * Controllers are integration-tested through the full Express stack via supertest.
 */
import 'dotenv/config';
import { AsyncLocalStorage } from 'node:async_hooks';
import { beforeAll, afterAll, test as base } from 'vitest';
export { describe, expect, beforeEach, afterEach } from 'vitest';
import express, { type Application, type Request, type Response, type NextFunction, type ErrorRequestHandler } from 'express';
import { DataSource, type QueryRunner } from 'typeorm';
import {
  User,
  AccountQuotaUsage,
  Media,
  MediaExternalId,
  Segment,
  Episode,
  ApiAuth,
  ApiAuthPermission,
  Character,
  Seiyuu,
  MediaCharacter,
  Collection,
  CollectionSegment,
  Series,
  SeriesMedia,
  Report,
  ReviewCheck,
  ReviewCheckRun,
  ReviewAllowlist,
  UserActivity,
  LabUserEnrollment,
} from '@app/models';
import { ApiKeyKind, ApiPermission, AuthType } from '@app/models/ApiPermission';
import { getAppPostgresConfig } from '@config/postgresConfig';
import { handleErrors } from '@app/middleware/errorHandler';
import { requestIdMiddleware } from '@app/middleware/requestId';
import { handleJsonParseErrors } from '@app/middleware/requestParsing';
import { NotFoundError } from '@app/errors';
import { MediaRoutes, UserRoutes } from '@app/routes/router';

const postgres = getAppPostgresConfig();

/**
 * Separate DataSource for tests — uses the test DB with its own connection pool.
 *
 * Schema setup: run migrations against the test DB before running tests:
 *   POSTGRES_DB=nadeshiko_test bun run db:migrate
 */
export const TestDataSource = new DataSource({
  type: 'postgres',
  host: postgres.host,
  port: postgres.port,
  username: postgres.user,
  password: postgres.password,
  database: postgres.database,
  entities: [
    User, AccountQuotaUsage, Media, MediaExternalId, Segment, Episode,
    ApiAuth, ApiAuthPermission, Character, Seiyuu, MediaCharacter,
    Collection, CollectionSegment, Series, SeriesMedia,
    Report, ReviewCheck, ReviewCheckRun, ReviewAllowlist, UserActivity,
    LabUserEnrollment,
  ],
  synchronize: false,
  logging: false,
  extra: { max: 5, min: 1 },
});

// ------------------------------------------------------------------
// Transactional test isolation via AsyncLocalStorage
// ------------------------------------------------------------------
//
// Each test runs its DB calls through a QueryRunner stored in async
// context. Concurrent tests within the same file each get their own
// runner — no shared mutable module-level variable.
//
// _originalCreateQueryRunner is set once in beforeAll and never
// changes, so it is safe to read from concurrent test contexts.
// ------------------------------------------------------------------

const runnerStore = new AsyncLocalStorage<QueryRunner>();
let _originalCreateQueryRunner: DataSource['createQueryRunner'] | null = null;

async function ensureTestSchemaCompatibility() {
  await TestDataSource.query(
    `ALTER TABLE "UserActivity" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now()`,
  );
}

// ------------------------------------------------------------------
// Auto fixture — wraps every test in its own transaction
// ------------------------------------------------------------------

export const it = base.extend<{ _transaction: void }>({
  _transaction: [
    async ({}, use) => {
      const runner = _originalCreateQueryRunner!();
      await runner.connect();
      await runner.startTransaction();

      // No-op release so TypeORM doesn't close the runner mid-test
      const realRelease = runner.release.bind(runner);
      runner.release = () => Promise.resolve();

      // Bind this runner to the current test's async context
      await runnerStore.run(runner, async () => use());

      await runner.rollbackTransaction();
      runner.release = realRelease;
      await runner.release();
    },
    { auto: true },
  ],
});

// ------------------------------------------------------------------
// Auth helper — like Rails' `sign_in_as`
// ------------------------------------------------------------------

/**
 * Set the user for subsequent requests on this app instance.
 * Stores on app.locals so each test app is independent.
 * Pass null to sign out.
 */
export function signInAs(app: Application, user: User | null) {
  app.locals.testUser = user;
}

function testAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const user = req.app.locals.testUser;
  if (user) {
    req.user = user;
    req.auth = {
      type: AuthType.API_KEY,
      apiKey: {
        kind: ApiKeyKind.SERVICE,
        permissions: Object.values(ApiPermission),
      },
    };
  }
  next();
}

// ------------------------------------------------------------------
// App factory
// ------------------------------------------------------------------

/**
 * Builds a minimal Express app with the same middleware stack as production,
 * but with test auth injected instead of real auth.
 */
export function createTestApp() {
  const app = express();

  app.use(requestIdMiddleware);
  app.use(express.json());
  app.use(handleJsonParseErrors);
  app.use(testAuthMiddleware);

  app.use('/', MediaRoutes);
  app.use('/', UserRoutes);

  app.use((req, res) => {
    const error = new NotFoundError(`Cannot ${req.method} ${req.originalUrl}`);
    res.status(error.status).json(error.toJSON());
  });

  app.use(handleErrors as ErrorRequestHandler);

  return app;
}

// ------------------------------------------------------------------
// Setup — call this at the top of each test file
// ------------------------------------------------------------------

/**
 * Sets up transactional test isolation for a test file.
 * Call once at the top level of each test file:
 *
 *   import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
 *   setupTestSuite();
 *
 * This registers beforeAll/afterAll hooks that:
 * - Initialize the DB connection once per file
 * - Patch createQueryRunner to read from AsyncLocalStorage
 * - Restore and destroy on teardown
 *
 * Per-test transaction setup/rollback is handled automatically by the
 * _transaction auto-fixture on the exported `it`.
 */
export function setupTestSuite() {
  beforeAll(async () => {
    await TestDataSource.initialize();
    await ensureTestSchemaCompatibility();

    _originalCreateQueryRunner = TestDataSource.createQueryRunner.bind(TestDataSource);

    TestDataSource.createQueryRunner = () => {
      const runner = runnerStore.getStore();
      if (!runner) throw new Error('No test transaction active — did you call setupTestSuite()?');
      return runner;
    };
  });

  afterAll(async () => {
    if (_originalCreateQueryRunner) {
      TestDataSource.createQueryRunner = _originalCreateQueryRunner;
      _originalCreateQueryRunner = null;
    }
    if (TestDataSource.isInitialized) {
      await TestDataSource.destroy();
    }
  });
}
```

**Step 2: Run all controller tests**

```bash
bun run test -- tests/controllers/
```

Expected: 51 tests passing. No behavior change — serial tests still work identically.

**Step 3: Commit**

```
jj describe -m "test: replace module-level QueryRunner with AsyncLocalStorage for concurrent test support"
jj new
```

---

### Task 2: Update test file imports

**Files:**
- Modify: `tests/controllers/seiyuuController.test.ts`
- Modify: `tests/controllers/characterController.test.ts`
- Modify: `tests/controllers/episodeController.test.ts`
- Modify: `tests/controllers/seriesController.test.ts`
- Modify: `tests/controllers/userExportController.test.ts`
- Modify: `tests/controllers/userQuotaController.test.ts`
- Modify: `tests/controllers/mappers/episode.mapper.test.ts`

**Step 1: Update the import in each file**

For all files in `tests/controllers/*.test.ts`, change:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
```
to:
```typescript
import { describe, it, expect, beforeEach } from '../helpers/setup';
```

For `tests/controllers/mappers/episode.mapper.test.ts` (one directory deeper):
```typescript
import { describe, it, expect, beforeEach } from '../../helpers/setup';
```

Note: `userExportController.test.ts` imports `{ describe, it, expect, beforeEach }` — same change applies.
Note: `userQuotaController.test.ts` may import a subset — update whichever symbols are imported.

**Step 2: Run all tests**

```bash
bun run test -- tests/controllers/
```

Expected: 51 tests passing.

**Step 3: Commit**

```
jj describe -m "test: import it/describe/expect from setup helper instead of vitest directly"
jj new
```

---

### Task 3: Add GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/test.yml` (at the monorepo root: `/home/davafons/workspace/Nadeshiko/.github/workflows/test.yml`)

**Step 1: Create the workflow file**

```yaml
name: Test

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: nadeshiko_test
          POSTGRES_USER: nadeshiko
          POSTGRES_PASSWORD: nadeshiko
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5

    defaults:
      run:
        working-directory: backend

    env:
      POSTGRES_HOST: localhost
      POSTGRES_PORT: 5432
      POSTGRES_USER: nadeshiko
      POSTGRES_PASSWORD: nadeshiko
      POSTGRES_DB: nadeshiko_test
      BASE_URL: http://localhost:3000
      LOG_LEVEL: silent

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Run migrations
        run: bun run db:migrate

      - name: Run tests
        run: bun run test
```

**Step 2: Verify migrations run correctly locally against the test DB**

```bash
POSTGRES_DB=nadeshiko_test bun run db:migrate
```

Expected: migrations apply (or report "No pending migrations" if already up to date).

**Step 3: Commit**

```
jj describe -m "ci: add GitHub Actions workflow with Postgres service container"
jj new
```
