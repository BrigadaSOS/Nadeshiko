/**
 * Integration test setup — real database, real HTTP stack, no mocks.
 *
 * Follows the Rails/37signals philosophy: test against the real database
 * with transaction-wrapped isolation. Each test runs inside a transaction
 * that gets rolled back — no truncation, no deadlocks, instant cleanup.
 *
 * Uses a module-level QueryRunner patched into TestDataSource.createQueryRunner
 * so all TypeORM operations in a test share the same transaction. Tests run
 * serially within a file and, per vitest.config.ts, one file at a time.
 *
 * Controllers are integration-tested through the full Express stack via supertest.
 */
import 'dotenv/config';
import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Application, Request, Response, NextFunction } from 'express';
import { DataSource, type QueryRunner } from 'typeorm';
import { User } from '@app/models';
import { ApiKeyKind, ApiPermission, AuthType } from '@app/models/ApiPermission';
import { APP_ENTITIES, APP_SUBSCRIBERS, getDbLogging } from '@config/schema';
import { getAppPostgresConfig } from '@config/postgresConfig';
import { buildApplication } from '@config/application';
import type { Server } from 'http';
import { MediaRoutes, UserRoutes, CollectionsRoutes, ActivityRoutes, SearchRoutes } from '@config/routes';
import { resetRateLimiters } from '@app/middleware/rateLimit';

const postgres = getAppPostgresConfig();

/**
 * Separate DataSource for tests — uses the test DB with its own connection pool.
 * Shares the same entities and subscribers as production via config/schema.ts.
 *
 * Schema setup: run once before running tests (drops and remigrates the test DB):
 *   npm run test:setup
 */
export const TestDataSource = new DataSource({
  type: 'postgres',
  host: postgres.host,
  port: postgres.port,
  username: postgres.user,
  password: postgres.password,
  database: postgres.database,
  entities: APP_ENTITIES,
  subscribers: APP_SUBSCRIBERS,
  synchronize: false,
  logging: getDbLogging(),
  extra: { max: 5, min: 1 },
});

let _testQueryRunner: QueryRunner | null = null;
let _originalCreateQueryRunner: DataSource['createQueryRunner'] | null = null;

/** A listening test server, keeping a handle on the Express app it serves. */
export type TestServer = Server & { app: Application };

/**
 * Set the user for subsequent requests on this app instance.
 * Pass null to sign out.
 */
export function signInAs(target: Application | TestServer, user: User | null) {
  // Accepts either, so callers holding a `createTestApp()` server and callers
  // holding a hand-built app both work without knowing which they have.
  const app = 'locals' in target ? target : target.app;
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

/** Servers opened by `createTestApp`, closed together in `afterAll`. */
const _openServers: TestServer[] = [];

/**
 * Builds a minimal Express app with the same middleware stack as production,
 * but with test auth injected instead of real auth.
 *
 * Returns an already-listening server rather than the bare app. Supertest binds
 * a fresh ephemeral server for every `request(app)` when handed an app, and a
 * full-suite run makes thousands of those; the resulting port churn made a random
 * test fail with ETIMEDOUT roughly one run in five. Handed a listening server it
 * reuses the address instead, so a file now binds once rather than per request.
 */
export function createTestApp(): TestServer {
  const app = buildApplication({
    rateLimit: false,
    beforeRoutes: [testAuthMiddleware],
    mountRoutes: (instance) => {
      instance.use('/', SearchRoutes);
      instance.use('/', MediaRoutes);
      instance.use('/', ActivityRoutes);
      instance.use('/', UserRoutes);
      instance.use('/', CollectionsRoutes);
    },
  });

  const server = Object.assign(app.listen(0), { app }) as TestServer;
  _openServers.push(server);
  return server;
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
 * Registers lifecycle hooks that:
 * - Initialize the DB connection once per file
 * - Wrap each test in a transaction rolled back on teardown
 */
export function setupTestSuite() {
  beforeAll(async () => {
    await TestDataSource.initialize();
    _originalCreateQueryRunner = TestDataSource.createQueryRunner.bind(TestDataSource);
  });

  beforeEach(async () => {
    // The limiters are in-process singletons shared by every test file in a
    // single-fork run, so a file that exhausts a bucket would 429 the next one.
    resetRateLimiters();

    // beforeAll assigns this; if it is missing the suite is misconfigured and
    // every following line would fail on undefined anyway. Say so once, here.
    if (!_originalCreateQueryRunner) {
      throw new Error('setupTestSuite: beforeAll did not run, so no query runner factory is available');
    }

    const runner = _originalCreateQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    // No-op release so TypeORM doesn't close the runner mid-test
    runner.release = () => Promise.resolve();

    _testQueryRunner = runner;
    TestDataSource.createQueryRunner = () => runner;
  });

  afterEach(async () => {
    const runner = _testQueryRunner;
    if (runner) {
      await runner.rollbackTransaction();
      // beforeEach assigned a no-op `release` as an own property, shadowing the
      // prototype method; deleting it uncovers the real one again.
      delete (runner as { release?: QueryRunner['release'] }).release;
      await runner.release();
      _testQueryRunner = null;
    }
  });

  afterAll(async () => {
    await Promise.all(
      _openServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );

    if (_originalCreateQueryRunner) {
      TestDataSource.createQueryRunner = _originalCreateQueryRunner;
      _originalCreateQueryRunner = null;
    }
    if (TestDataSource.isInitialized) {
      await TestDataSource.destroy();
    }
  });
}
