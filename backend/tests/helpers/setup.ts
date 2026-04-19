/**
 * Integration test setup — real database, real HTTP stack, no mocks.
 *
 * Follows the Rails/37signals philosophy: test against the real database
 * with transaction-wrapped isolation. Each test runs inside a transaction
 * that gets rolled back — no truncation, no deadlocks, instant cleanup.
 *
 * Uses a module-level QueryRunner patched into TestDataSource.createQueryRunner
 * so all TypeORM operations in a test share the same transaction. Tests within
 * a file run serially (default); between files they run in parallel.
 *
 * Controllers are integration-tested through the full Express stack via supertest.
 */
import 'dotenv/config';
import { beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import type { Application, Request, Response, NextFunction } from 'express';
import { DataSource, type QueryRunner } from 'typeorm';
import { User } from '@app/models';
import { ApiKeyKind, ApiPermission, AuthType } from '@app/models/ApiPermission';
import { APP_ENTITIES, APP_SUBSCRIBERS, getDbLogging } from '@config/schema';
import { getAppPostgresConfig } from '@config/postgresConfig';
import { buildApplication } from '@config/application';
import { MediaRoutes, UserRoutes, CollectionsRoutes, ActivityRoutes, SearchRoutes } from '@config/routes';

const postgres = getAppPostgresConfig();

/**
 * Separate DataSource for tests — uses the test DB with its own connection pool.
 * Shares the same entities and subscribers as production via config/schema.ts.
 *
 * Schema setup: run once before running tests (drops and remigrates the test DB):
 *   bun run test:setup
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

/**
 * Set the user for subsequent requests on this app instance.
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

/**
 * Builds a minimal Express app with the same middleware stack as production,
 * but with test auth injected instead of real auth.
 */
export function createTestApp() {
  return buildApplication({
    beforeRoutes: [testAuthMiddleware],
    mountRoutes: (app) => {
      app.use('/', SearchRoutes);
      app.use('/', MediaRoutes);
      app.use('/', ActivityRoutes);
      app.use('/', UserRoutes);
      app.use('/', CollectionsRoutes);
    },
  });
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
    const runner = _originalCreateQueryRunner?.();
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
      // Remove the no-op override to restore the prototype method
      delete (runner as any).release;
      await runner.release();
      _testQueryRunner = null;
    }
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
