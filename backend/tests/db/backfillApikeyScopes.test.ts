import { describe, it, expect, beforeAll } from 'vitest';
import { setupTestSuite, TestDataSource } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { BackfillApikeyScopes1743600000000 } from '../../db/migrations/1743600000000-backfill-apikey-scopes';

setupTestSuite();

let fixtures: CoreFixtures;
beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

const runner = () => TestDataSource.createQueryRunner();

/**
 * One `apikey` row with the permissions column set exactly as given, found again
 * by name. The id is left to the column default and the owner goes in
 * `referenceId` -- better-auth renamed that column from `userId`, so spelling
 * either by hand is how this fixture drifts out from under the migration.
 */
async function insertKey(label: string, permissions: string | null): Promise<void> {
  await runner().query(
    `INSERT INTO "apikey" ("name", "start", "prefix", "key", "referenceId", "enabled", "permissions", "createdAt", "updatedAt")
     VALUES ($1, 'nade_', 'nade_', $2, $3, true, $4, now(), now())`,
    [`test-${label}`, `hash-${label}`, String(fixtures.users.regular.id), permissions],
  );
}

const permissionsOf = async (label: string): Promise<string[]> => {
  const rows = await runner().query(`SELECT "permissions" FROM "apikey" WHERE "name" = $1`, [`test-${label}`]);
  const raw = rows[0]?.permissions;
  if (!raw) return [];
  return JSON.parse(raw).api ?? [];
};

const backfill = () => new BackfillApikeyScopes1743600000000().up(runner());

/**
 * The migration that gave every pre-scopes key the account scopes it had been
 * using implicitly.
 *
 * What is actually at stake is `READ_MEDIA`, and it is at stake by omission:
 * the migration's job is to ADD the profile, activity and collection scopes, so
 * nothing in it mentions the corpus at all. A rewrite of that `jsonb_set` that
 * replaced the array instead of unioning onto it would strip corpus access from
 * every key in circulation, and the migration would still look like it was only
 * adding things. Raw SQL, nothing type-checks it, and it runs once against
 * production -- so the property is pinned here rather than trusted.
 *
 * Re-running `up` is safe by construction: the final `WHERE ... IS DISTINCT
 * FROM` makes it a no-op once applied, which is why this can execute against a
 * database the migration has already been through.
 */
describe('BackfillApikeyScopes', () => {
  it('leaves READ_MEDIA on a key that had it, while adding the account scopes', async () => {
    // The shape better-auth persisted before scopes existed: DEFAULT_USER_API_PERMISSIONS.
    await insertKey('legacy-full', JSON.stringify({ api: ['READ_MEDIA', 'READ_PROFILE'] }));

    await backfill();

    const after = await permissionsOf('legacy-full');
    expect(after).toContain('READ_MEDIA');
    expect(after).toEqual(expect.arrayContaining(['READ_ACTIVITY', 'WRITE_ACTIVITY', 'READ_COLLECTIONS']));
  });

  it('keeps the corpus-write scopes a service key was created with', async () => {
    await insertKey('service-key', JSON.stringify({ api: ['READ_MEDIA', 'UPDATE_MEDIA'] }));

    await backfill();

    expect(await permissionsOf('service-key')).toEqual(expect.arrayContaining(['READ_MEDIA', 'UPDATE_MEDIA']));
  });

  it('renames the LISTS scopes to COLLECTIONS without dropping anything else', async () => {
    await insertKey('legacy-lists', JSON.stringify({ api: ['READ_MEDIA', 'READ_LISTS', 'DELETE_LISTS'] }));

    await backfill();

    const after = await permissionsOf('legacy-lists');
    expect(after).toContain('READ_MEDIA');
    expect(after).toEqual(expect.arrayContaining(['READ_COLLECTIONS', 'DELETE_COLLECTIONS']));
    expect(after).not.toContain('READ_LISTS');
  });

  /**
   * The one row shape this migration cannot rescue, recorded so the limit is
   * known rather than discovered. Every creation path persists a permission list
   * -- better-auth's `defaultPermissions`, `createUserApiKey`, and
   * `bin/createServiceKey` -- and the `apikey` table was created empty, so a row
   * like this can only arrive by hand. If one ever does, it reads the corpus
   * nowhere, and no migration can tell what it was supposed to be allowed.
   */
  it('cannot invent corpus access for a row that never stored any', async () => {
    await insertKey('null-perms', null);

    await backfill();

    expect(await permissionsOf('null-perms')).not.toContain('READ_MEDIA');
  });
});
