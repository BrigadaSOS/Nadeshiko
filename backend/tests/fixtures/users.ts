import { User, UserRoleType } from '@app/models/User';

/**
 * Seed a test user. Auth is handled by the test middleware (signInAs),
 * so no API key record is needed.
 */
export async function seedTestUser(overrides: Record<string, unknown> = {}) {
  const user = User.create({
    username: 'testuser',
    email: 'test@nadeshiko.test',
    isVerified: true,
    isActive: true,
    role: UserRoleType.ADMIN,
    preferences: {},
    ...overrides,
  });
  await user.save();
  return user;
}
