import { User, ApiPermission, UserRoleType } from '@app/entities';
import { AppDataSource } from '@config/database';
import { getAppEnvironment } from '@lib/environment';
import { logger } from '@lib/utils/log';
import { defaultKeyHasher } from 'better-auth/plugins';

const SEEDED_MASTER_KEY_NAME = 'Local Master Key';
const BETTER_AUTH_PERMISSION_RESOURCE = 'api';

function inferApiKeyPrefix(apiKey: string): string | null {
  const separatorIndex = apiKey.indexOf('_');
  if (separatorIndex <= 0) {
    return null;
  }
  return apiKey.slice(0, separatorIndex + 1);
}

/**
 * Seed function for all environments.
 * Creates an admin user and a deterministic Better Auth API key.
 *
 * Safe to run in production because credentials come from environment variables.
 * Idempotent: updates existing records when needed.
 */
export async function seed() {
  const environment = getAppEnvironment();
  logger.info({ environment }, 'Running seeds for environment');

  // Get credentials from environment variables
  const email = process.env.EMAIL_API_NADEDB;
  const username = process.env.USERNAME_API_NADEDB;
  const apiKey = process.env.API_KEY_MASTER;

  if (!email || !username || !apiKey) {
    logger.error('Missing required environment variables for seeding');
    logger.error('Required: EMAIL_API_NADEDB, USERNAME_API_NADEDB, API_KEY_MASTER');
    return;
  }

  // Ensure admin user exists
  const existingUser = await User.findOne({
    where: { email },
  });

  let user: User;
  if (!existingUser) {
    user = User.create({
      username,
      email,
      isActive: true,
      isVerified: true,
      role: UserRoleType.ADMIN,
    });
    await user.save();
    logger.info({ userId: user.id, email }, 'Admin user created');
  } else {
    user = existingUser;
    if (!user.isActive || !user.isVerified || user.username !== username || user.role !== UserRoleType.ADMIN) {
      user.username = username;
      user.isActive = true;
      user.isVerified = true;
      user.role = UserRoleType.ADMIN;
      await user.save();
    }
    logger.info({ userId: user.id, email }, 'Admin user ensured');
  }

  // Seed deterministic Better Auth API key for local/dev testing.
  const hashedApiKey = await defaultKeyHasher(apiKey);
  const keyPrefix = inferApiKeyPrefix(apiKey);
  const permissions = JSON.stringify({
    [BETTER_AUTH_PERMISSION_RESOURCE]: Object.values(ApiPermission),
  });
  const metadata = JSON.stringify({
    keyType: 'service',
    source: 'seed',
  });

  await AppDataSource.query(
    `
      INSERT INTO "apikey" (
        "name",
        "start",
        "prefix",
        "key",
        "userId",
        "enabled",
        "rateLimitEnabled",
        "metadata",
        "permissions",
        "createdAt",
        "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, true, false, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("key")
      DO UPDATE SET
        "name" = EXCLUDED."name",
        "start" = EXCLUDED."start",
        "prefix" = EXCLUDED."prefix",
        "userId" = EXCLUDED."userId",
        "enabled" = true,
        "rateLimitEnabled" = false,
        "metadata" = EXCLUDED."metadata",
        "permissions" = EXCLUDED."permissions",
        "updatedAt" = CURRENT_TIMESTAMP
    `,
    [SEEDED_MASTER_KEY_NAME, apiKey.slice(0, 6), keyPrefix, hashedApiKey, user.id, metadata, permissions],
  );

  logger.info({ userId: user.id, keyName: SEEDED_MASTER_KEY_NAME }, 'Better Auth API key ensured');

  logger.info('Seed completed successfully');
}
