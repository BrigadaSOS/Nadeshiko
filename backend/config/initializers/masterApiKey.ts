import { defaultKeyHasher } from '@better-auth/api-key';
import { inferApiKeyKind } from '@app/middleware/authentication';
import { ApiKeyKind } from '@app/models';
import { config } from '@config/config';
import { AppDataSource } from '@config/database';
import { isLocalEnvironment } from '@config/environment';
import { logger } from '@config/log';
import type { RuntimeInitializer } from './types';

/** The anonymous-corpus proxy key must be a SERVICE key and may reach only generated public routes; a USER key would
 * spend one account’s quota for the whole internet, so boot rejects it outside local. */
async function assertMasterApiKeyIsService(): Promise<void> {
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
