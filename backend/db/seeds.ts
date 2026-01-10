import { ApiAuth, User, ApiPermission, ApiAuthPermission, UserRole, Role } from '@app/entities';
import { logger } from '@lib/utils/log';
import { hashApiKey, generateApiKeyHint } from '@lib/utils/utils';

/**
 * Seed function for all environments.
 * Creates default roles, an admin user with API key and full permissions.
 *
 * Safe to run in production because credentials come from environment variables.
 * Only creates the user if it doesn't already exist (idempotent).
 */
export async function seed() {
  const environment = process.env.ENVIRONMENT || 'development';
  logger.info({ environment }, 'Running seeds for environment');

  // Insert default roles
  const roles = [
    { id: 1, name: 'ADMIN', description: 'Administrator', quotaLimit: -1 },
    { id: 2, name: 'MOD', description: 'Moderator', quotaLimit: -1 },
    { id: 3, name: 'USER', description: 'User', quotaLimit: 20000 },
    { id: 5, name: 'PATREON', description: 'Patreon', quotaLimit: -1 },
  ];

  for (const roleData of roles) {
    const role = Role.create(roleData);
    await role.save();
  }

  logger.info('Default roles created');

  // Get credentials from environment variables
  const email = process.env.EMAIL_API_NADEDB;
  const username = process.env.USERNAME_API_NADEDB;
  const password = process.env.PASSWORD_API_NADEDB;
  const apiKey = process.env.API_KEY_MASTER;

  if (!email || !username || !password || !apiKey) {
    logger.error('Missing required environment variables for seeding');
    logger.error('Required: EMAIL_API_NADEDB, USERNAME_API_NADEDB, PASSWORD_API_NADEDB, API_KEY_MASTER');
    return;
  }

  // Check if admin user already exists
  const existingUser = await User.findOne({
    where: { email },
  });

  if (existingUser) {
    logger.info({ email }, 'Admin user already exists, skipping creation');
    return;
  }

  // Create admin user
  const encryptedPassword = await Bun.password.hash(password, {
    algorithm: 'bcrypt',
    cost: 10,
  });

  const user = User.create({
    username,
    password: encryptedPassword,
    email,
    isActive: true,
    isVerified: true,
  });
  await user.save();

  logger.info({ userId: user.id, email }, 'Admin user created');

  // Create API auth
  const apiKeyHashed = hashApiKey(apiKey);
  const apiKeyHint = generateApiKeyHint(apiKey);

  const apiAuth = ApiAuth.create({
    name: 'Default Admin Key',
    hint: apiKeyHint,
    token: apiKeyHashed,
    createdAt: new Date(),
    isActive: true,
    userId: user.id,
  });
  await apiAuth.save();

  logger.info({ apiAuthId: apiAuth.id }, 'API key created');

  // Assign admin role
  const userRole = UserRole.create({
    userId: user.id,
    roleId: 1, // Admin role
  });
  await userRole.save();

  logger.info({ userId: user.id, roleId: 1 }, 'Admin role assigned');

  // Assign all permissions to API key using the enum
  const allPermissions = Object.values(ApiPermission);

  await Promise.all(
    allPermissions.map(async (permission) => {
      const authPermission = ApiAuthPermission.create({
        apiAuthId: apiAuth.id,
        apiPermission: permission,
      });
      await authPermission.save();
    }),
  );

  logger.info({ apiAuthId: apiAuth.id, permissionCount: allPermissions.length }, 'All permissions assigned');

  logger.info('Seed completed successfully');
}
