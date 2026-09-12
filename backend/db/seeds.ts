import { User, ApiPermission, UserRoleType, Collection, CollectionType, CollectionVisibility } from '@app/models';
import { AppDataSource } from '@config/database';
import { config } from '@config/config';
import { getAppEnvironment } from '@config/environment';
import { logger } from '@config/log';
import { defaultKeyHasher } from '@better-auth/api-key';
import { hashPassword } from 'better-auth/crypto';

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
  const environment = getAppEnvironment(config.ENVIRONMENT);
  logger.info({ environment }, 'Running seeds for environment');

  const email = config.EMAIL_API_NADEDB;
  const username = config.USERNAME_API_NADEDB;
  const apiKey = config.API_KEY_MASTER;

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
    const collectionCount = await Collection.count({ where: { userId: user.id } });
    if (collectionCount === 0) {
      await Collection.save([
        Collection.create({
          name: 'Favorites',
          type: CollectionType.USER,
          userId: user.id,
          visibility: CollectionVisibility.PRIVATE,
        }),
        Collection.create({
          name: 'Anki Exports',
          type: CollectionType.ANKI_EXPORT,
          userId: user.id,
          visibility: CollectionVisibility.PRIVATE,
        }),
      ]);
    }
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
        "referenceId",
        "configId",
        "enabled",
        "rateLimitEnabled",
        "metadata",
        "permissions",
        "createdAt",
        "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, 'default', true, false, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("key")
      DO UPDATE SET
        "name" = EXCLUDED."name",
        "start" = EXCLUDED."start",
        "prefix" = EXCLUDED."prefix",
        "referenceId" = EXCLUDED."referenceId",
        "configId" = EXCLUDED."configId",
        "enabled" = true,
        "rateLimitEnabled" = false,
        "metadata" = EXCLUDED."metadata",
        "permissions" = EXCLUDED."permissions",
        "updatedAt" = CURRENT_TIMESTAMP
    `,
    [SEEDED_MASTER_KEY_NAME, apiKey.slice(0, 6), keyPrefix, hashedApiKey, String(user.id), metadata, permissions],
  );

  logger.info({ userId: user.id, keyName: SEEDED_MASTER_KEY_NAME }, 'Better Auth API key ensured');

  await seedE2ETestUsers();

  logger.info('Seed completed successfully');
}

/**
 * One account per Playwright worker.
 *
 * The browser suite mutates preferences, collections, API keys and activity.
 * Sharing one account forced CI down to one worker and made the suite take more
 * than twenty minutes. These users all use the same deployment-only secret,
 * but have independent server-side state so the suite can run concurrently.
 * Keep index zero at the historical address for production smoke and existing
 * installations; the additional accounts are used by the staging workers.
 */
// Eight accounts back the parallel workers; index eight is a dedicated
// cross-account reader, index nine is a staging-only admin, and index ten is a
// disposable account for the destructive deletion journey. None is borrowed
// from an active worker, so authorization tests cannot revoke or mutate another
// spec's session. `db:prepare` recreates the disposable user before every run.
const E2E_TEST_USERS = Array.from({ length: 11 }, (_, index) => ({
  username: index === 0 ? 'e2e-user' : `e2e-user-${index}`,
  email: index === 0 ? 'e2e-user@nadeshiko.co' : `e2e-user-${index}@nadeshiko.co`,
  passwordEnvKey: 'E2E_USER_PASSWORD' as const,
  role: index === 9 ? UserRoleType.ADMIN : UserRoleType.USER,
}));

export async function seedE2ETestUsers() {
  // Production only runs the serial account-zero smoke suite. Keep the wider
  // pool out of the production user table; staging and local need all eight
  // workers plus the dedicated cross-account reader.
  const testUsers =
    getAppEnvironment(config.ENVIRONMENT) === 'production' ? E2E_TEST_USERS.slice(0, 1) : E2E_TEST_USERS;
  for (const testUser of testUsers) {
    const password = config[testUser.passwordEnvKey];
    if (!password) {
      logger.info({ email: testUser.email }, 'E2E password env var not set, skipping test user');
      continue;
    }

    const existing = await User.findOne({ where: { email: testUser.email } });
    const passwordHash = await hashPassword(password);
    await AppDataSource.transaction(async (manager) => {
      const user =
        existing ??
        User.create({
          username: testUser.username,
          email: testUser.email,
          isActive: true,
          isVerified: true,
          role: testUser.role,
        });
      user.username = testUser.username;
      user.isActive = true;
      user.isVerified = true;
      user.role = testUser.role;
      await manager.save(user);

      // Keep the shared deployment secret rotatable. Existing E2E accounts are
      // updated as well as newly inserted ones; active sessions remain valid.
      await manager.query(
        `
          INSERT INTO "account" (
            "account_id", "provider_id", "user_id", "password", "created_at", "updated_at"
          )
          VALUES ($1, 'credential', $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT ("provider_id", "account_id")
          DO UPDATE SET
            "user_id" = EXCLUDED."user_id",
            "password" = EXCLUDED."password",
            "updated_at" = CURRENT_TIMESTAMP
        `,
        [String(user.id), user.id, passwordHash],
      );

      const defaults = [
        { name: 'Favorites', type: CollectionType.USER },
        { name: 'Anki Exports', type: CollectionType.ANKI_EXPORT },
      ] as const;
      for (const collection of defaults) {
        const present = await manager.count(Collection, {
          where: { userId: user.id, name: collection.name, type: collection.type },
        });
        if (present === 0) {
          await manager.save(
            Collection.create({
              ...collection,
              userId: user.id,
              visibility: CollectionVisibility.PRIVATE,
            }),
          );
        }
      }
    });

    logger.info({ email: testUser.email }, 'E2E test user ensured');
  }
}
