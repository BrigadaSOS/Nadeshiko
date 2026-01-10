import { ApiAuth, User, ApiPermission, ApiAuthPermission, UserRole, Role } from '@app/entities';
import { AppDataSource } from '@config/database';
import { logger } from '@lib/utils/log';
import { hashApiKey, generateApiKeyHint } from '@lib/utils/utils';

const roleRepository = AppDataSource.getRepository(Role);
const userRepository = AppDataSource.getRepository(User);
const apiAuthRepository = AppDataSource.getRepository(ApiAuth);
const apiAuthPermissionRepository = AppDataSource.getRepository(ApiAuthPermission);
const userRoleRepository = AppDataSource.getRepository(UserRole);

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
    { id: 1, name: 'ADMIN', description: 'Administrator', quota_limit: -1 },
    { id: 2, name: 'MOD', description: 'Moderator', quota_limit: -1 },
    { id: 3, name: 'USER', description: 'User', quota_limit: 20000 },
    { id: 5, name: 'PATREON', description: 'Patreon', quota_limit: -1 },
  ];

  for (const role of roles) {
    await roleRepository.save(roleRepository.create(role));
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
  const existingUser = await userRepository.findOne({
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

  const user = new User();
  user.username = username;
  user.password = encryptedPassword;
  user.email = email;
  user.isActive = true;
  user.isVerified = true;
  const newUser = await userRepository.save(user);

  logger.info({ userId: newUser.id, email }, 'Admin user created');

  // Create API auth
  const apiKeyHashed = hashApiKey(apiKey);
  const apiKeyHint = generateApiKeyHint(apiKey);

  const apiAuth = new ApiAuth();
  apiAuth.name = 'Default Admin Key';
  apiAuth.hint = apiKeyHint;
  apiAuth.token = apiKeyHashed;
  apiAuth.createdAt = new Date();
  apiAuth.isActive = true;
  apiAuth.userId = newUser.id;
  const savedApiAuth = await apiAuthRepository.save(apiAuth);

  logger.info({ apiAuthId: savedApiAuth.id }, 'API key created');

  // Assign admin role
  const userRole = new UserRole();
  userRole.userId = newUser.id;
  userRole.roleId = 1; // Admin role
  await userRoleRepository.save(userRole);

  logger.info({ userId: newUser.id, roleId: 1 }, 'Admin role assigned');

  // Assign all permissions to API key using the enum
  const allPermissions = Object.values(ApiPermission);

  await Promise.all(
    allPermissions.map(async (permission) => {
      const authPermission = new ApiAuthPermission();
      authPermission.apiAuthId = savedApiAuth.id;
      authPermission.apiPermission = permission;
      await apiAuthPermissionRepository.save(authPermission);
    }),
  );

  logger.info({ apiAuthId: savedApiAuth.id, permissionCount: allPermissions.length }, 'All permissions assigned');

  logger.info('Seed completed successfully');
}
