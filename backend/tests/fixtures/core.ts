import type { Application } from 'express';
import { signInAs } from '../helpers/setup';
import { User } from '@app/models/User';
import { FIXTURE_SETS } from './catalog';

export interface CoreFixtures {
  users: UserFixtures;
}

export interface UserFixtures {
  kevin: User;
  david: User;
  jz: User;
  mike: User;
}

// Upsert-based so it's safe to call from beforeAll across parallel workers.
// Rows are committed outside the per-test transaction and persist across tests.
export async function seedCoreFixtures(app?: Application): Promise<CoreFixtures> {
  const userDefs = FIXTURE_SETS.core.users;
  const users: Partial<UserFixtures> = {};

  for (const [name, data] of Object.entries(userDefs)) {
    await User.upsert(data, { conflictPaths: ['email'] });
    const user = await User.findOneByOrFail({ email: data.email as string });
    (users as Record<string, User>)[name] = user;
  }

  if (app) {
    signInAs(app, users.kevin!);
  }

  return { users: users as UserFixtures };
}
