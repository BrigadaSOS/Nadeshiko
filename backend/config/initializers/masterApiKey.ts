import { defaultKeyHasher } from '@better-auth/api-key';
import { inferApiKeyKind } from '@app/middleware/authentication';
import { ApiKeyKind } from '@app/models';
import { config } from '@config/config';
import { AppDataSource } from '@config/database';
import { isLocalEnvironment } from '@config/environment';
import { logger } from '@config/log';
import type { RuntimeInitializer } from './types';

/**
 * The frontend proxy signs its unauthenticated public-corpus traffic with
 * `API_KEY_MASTER`, so every visitor browsing anonymously shares that one
 * identity. That is only safe while the key is a SERVICE key: SERVICE keys are
 * exempt from the per-account quota and the per-IP rate limiter, and no
 * owner-scoped route is ever proxied with it (see the generated allowlist in
 * `frontend/server/utils/generated/publicApiRoutes.ts`).
 *
 * A USER key in that slot would silently drain one account's monthly quota on
 * behalf of the whole internet, so boot refuses to continue outside local.
 */
export async function assertMasterApiKeyIsService(): Promise<void> {
  const hashedKey = await defaultKeyHasher(config.API_KEY_MASTER);
  const rows: { metadata: unknown }[] = await AppDataSource.query(
    `SELECT "metadata" FROM "apikey" WHERE "key" = $1 LIMIT 1`,
    [hashedKey],
  );

  const row = rows[0];
  if (!row) {
    logger.warn('API_KEY_MASTER does not match any API key: proxied public requests will be rejected');
    return;
  }

  if (inferApiKeyKind(row) === ApiKeyKind.SERVICE) {
    return;
  }

  const message =
    "API_KEY_MASTER is not a SERVICE key: the frontend proxy would spend a single account's quota for every anonymous visitor";

  if (isLocalEnvironment()) {
    logger.warn(message);
    return;
  }

  throw new Error(message);
}

export const masterApiKeyInitializer: RuntimeInitializer = {
  name: 'masterApiKey',
  initialize: assertMasterApiKeyIsService,
};
