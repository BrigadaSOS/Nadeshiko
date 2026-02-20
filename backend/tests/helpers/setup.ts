/**
 * Integration test setup — real database, real HTTP stack, no mocks.
 *
 * Follows the DHH/37signals philosophy: test against the real database
 * with transaction-wrapped isolation. Controllers are integration-tested
 * through the full Express stack via supertest.
 */
import 'dotenv/config';
import express, { type Application, type Request, type Response, type NextFunction, type ErrorRequestHandler } from 'express';
import { DataSource } from 'typeorm';
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
} from '@app/models';
import { ApiKeyKind, ApiPermission, AuthType } from '@app/models/ApiPermission';
import { getAppPostgresConfig } from '@config/postgresConfig';
import { handleErrors } from '@app/middleware/errorHandler';
import { requestIdMiddleware } from '@app/middleware/requestId';
import { handleJsonParseErrors } from '@app/middleware/requestParsing';
import { NotFoundError } from '@app/errors';
import { MediaRoutes } from '@app/routes/router';

const postgres = getAppPostgresConfig();

/**
 * Separate DataSource for tests — uses the test DB with its own connection pool.
 * Uses synchronize: true to auto-create schema from entities (no migrations needed).
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
  ],
  synchronize: true,
  logging: false,
  extra: { max: 5, min: 1 },
});

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

  // Mount the real generated router from router.ts (no auth guards baked in).
  app.use('/', MediaRoutes);

  app.use((req, res) => {
    const error = new NotFoundError(`Cannot ${req.method} ${req.originalUrl}`);
    res.status(error.status).json(error.toJSON());
  });

  app.use(handleErrors as ErrorRequestHandler);

  return app;
}

// ------------------------------------------------------------------
// Database helpers
// ------------------------------------------------------------------

/**
 * Truncate tables in the right order (respecting FK constraints).
 */
export async function truncateTables(...tableNames: string[]) {
  if (tableNames.length === 0) return;
  const quoted = tableNames.map((t) => `"${t}"`).join(', ');
  await TestDataSource.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
}
