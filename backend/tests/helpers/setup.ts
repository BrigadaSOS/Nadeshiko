/** Integration setup uses a real database and HTTP stack with a module-level QueryRunner transaction rolled back
 * after each serial test; controllers run through Express and supertest. */
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

/** TestDataSource uses the test database and production entities/subscribers. Run `npm run test:setup` once to
 * recreate its schema. */
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

/** Set the user used by subsequent requests on this app; pass `null` to sign out. */
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

/** Build one listening app per route path with test auth injected. Reusing the server avoids supertest port churn
 * and intermittent `ETIMEDOUT` failures. */
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

// Setup — call this at the top of each test file.

/** Set up transactional isolation for a test file: initialize the DB once, then wrap each test in a transaction
 * rolled back during teardown. */
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
