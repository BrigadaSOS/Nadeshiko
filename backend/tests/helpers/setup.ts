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
import express, {
  type Application,
  type Request,
  type Response,
  type NextFunction,
  type ErrorRequestHandler,
} from 'express';
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
  Experiment,
  ExperimentEnrollment,
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
  entities: [
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
    Experiment,
    ExperimentEnrollment,
  ],
  synchronize: false,
  logging: false,
  extra: { max: 5, min: 1 },
});

// ------------------------------------------------------------------
// Transactional test isolation — module-level QueryRunner
// ------------------------------------------------------------------
//
// Tests within a file run serially (Vitest default for non-concurrent
// describes). Each test gets its own transaction via beforeEach/afterEach,
// rolled back on teardown for instant, side-effect-free isolation.
// ------------------------------------------------------------------

let _testQueryRunner: QueryRunner | null = null;
let _realRelease: (() => Promise<void>) | null = null;
let _originalCreateQueryRunner: DataSource['createQueryRunner'] | null = null;

/** Returns the current test's QueryRunner, or null if called outside a test. */
export function getTestQueryRunner(): QueryRunner | null {
  return _testQueryRunner;
}


// ------------------------------------------------------------------
// Auth helper — like Rails' `sign_in_as`
// ------------------------------------------------------------------

/**
 * Set the user for subsequent requests on this app instance.
 * Stores on app.locals so each test app is independent (safe for parallel tests).
 * Pass null to sign out.
 */
export function signInAs(app: Application, user: User | null) {
  app.locals.testUser = user;
}

/**
 * Middleware that injects the signed-in user, skipping real auth.
 * Reads from app.locals.testUser (per-app-instance, not module-level).
 */
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
 * No .listen(), no telemetry, no pg-boss.
 */
export function createTestApp() {
  const app = express();

  app.use(requestIdMiddleware);
  app.use(express.json());
  app.use(handleJsonParseErrors);
  app.use(testAuthMiddleware);

  // Mount the real generated routers from router.ts (no auth guards baked in).
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
 * This registers beforeAll/afterAll/beforeEach/afterEach hooks that:
 * - Initialize the DB connection once per file
 * - Wrap each test in a transaction (beforeEach) rolled back on teardown (afterEach)
 * - Restore and destroy on teardown
 */
export function setupTestSuite() {
  beforeAll(async () => {
    await TestDataSource.initialize();
    _originalCreateQueryRunner = TestDataSource.createQueryRunner.bind(TestDataSource);
  });

  beforeEach(async () => {
    _testQueryRunner = _originalCreateQueryRunner!();
    await _testQueryRunner.connect();
    await _testQueryRunner.startTransaction();

    // No-op release so TypeORM doesn't close the runner mid-test
    _realRelease = _testQueryRunner.release.bind(_testQueryRunner);
    _testQueryRunner.release = () => Promise.resolve();

    TestDataSource.createQueryRunner = () => _testQueryRunner!;
  });

  afterEach(async () => {
    if (_originalCreateQueryRunner) {
      TestDataSource.createQueryRunner = _originalCreateQueryRunner;
    }
    if (_testQueryRunner) {
      await _testQueryRunner.rollbackTransaction();
      if (_realRelease) _testQueryRunner.release = _realRelease;
      await _testQueryRunner.release();
      _testQueryRunner = null;
      _realRelease = null;
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
