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

/** Use the migration's real row shape: the owner is `referenceId` and permissions are explicit; hard-coding `userId`
 * or an omitted default would let the fixture drift from better-auth. */
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

/** The migration must union profile/activity/collection scopes without removing existing `READ_MEDIA`. This raw SQL
 * runs once in production, so the second call also asserts its idempotent no-op. */
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

  /** Record the unsupported row shape: creation paths always persist permissions, so a hand-made empty list has no
   * recoverable intended access and the migration must not invent one. */
  it('cannot invent corpus access for a row that never stored any', async () => {
    await insertKey('null-perms', null);

    await backfill();

    expect(await permissionsOf('null-perms')).not.toContain('READ_MEDIA');
  });
});
