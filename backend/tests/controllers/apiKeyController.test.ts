import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestSuite, createTestApp, signInAs, TestDataSource } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { ApiPermission } from '@app/models';

setupTestSuite();

const app = createTestApp();
let fixtures: CoreFixtures;

beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

beforeEach(() => {
  signInAs(app, fixtures.users.regular);
});

/**
 * NOTE ON CLEANUP, because the obvious fix does not work. better-auth writes
 * through its own `pg.Pool` (see `config/auth.ts`), not the QueryRunner this
 * suite patches into TypeORM, so keys created here commit for real and survive
 * the per-test rollback. A `DELETE FROM "apikey"` in an `afterEach` looks like
 * the answer and instead hangs the whole file indefinitely -- it contends with
 * the still-open per-test transaction and no hook timeout unblocks it.
 *
 * So the rows are left, and every assertion below is written to not care:
 * lookups go by the id just returned, and the one count-by-name asks about a
 * key this suite never successfully creates. `npm run test:setup` clears them.
 * A future test that LISTS a fixture user's keys would need to deal with this.
 */

/** The permission list as it was actually stored, which is what the key can do. */
async function storedPermissions(keyId: string): Promise<Record<string, string[]> | null> {
  const rows: { permissions: string | null }[] = await TestDataSource.query(
    `SELECT "permissions" FROM "apikey" WHERE "id" = $1 LIMIT 1`,
    [keyId],
  );
  const raw = rows[0]?.permissions;
  return raw ? JSON.parse(raw) : null;
}

describe('POST /v1/user/api-keys', () => {
  it('creates a key carrying exactly the scopes asked for', async () => {
    const res = await request(app)
      .post('/v1/user/api-keys')
      .send({ name: 'Entei (read-only)', scopes: [ApiPermission.READ_MEDIA] });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Entei (read-only)');
    expect(res.body.scopes).toEqual([ApiPermission.READ_MEDIA]);
    expect(res.body.key).toEqual(expect.stringContaining('nade_'));

    // The response echoing the right scopes is not the same claim as the key
    // being stored with them, and it is the stored list that is consulted on
    // every later request. A read-only key that was persisted with the full
    // default set would pass every assertion above.
    expect(await storedPermissions(res.body.id)).toEqual({ api: [ApiPermission.READ_MEDIA] });
  });

  it('returns the secret exactly once, and never in the list', async () => {
    const created = await request(app)
      .post('/v1/user/api-keys')
      .send({ name: 'once', scopes: [ApiPermission.READ_MEDIA] });

    const rows: { key: string }[] = await TestDataSource.query(`SELECT "key" FROM "apikey" WHERE "id" = $1 LIMIT 1`, [
      created.body.id,
    ]);

    // Stored hashed, so the plaintext in the response is genuinely the only copy.
    expect(rows[0]?.key).not.toBe(created.body.key);
  });

  describe('the scope ceiling', () => {
    it('refuses a corpus-write scope for a non-admin', async () => {
      const res = await request(app)
        .post('/v1/user/api-keys')
        .send({ name: 'sneaky', scopes: [ApiPermission.READ_MEDIA, ApiPermission.ADD_MEDIA] });

      expect(res.status).toBe(403);
      expect(res.body.detail).toContain('ADD_MEDIA');
    });

    it('refuses the whole request rather than dropping the scope it will not grant', async () => {
      const res = await request(app)
        .post('/v1/user/api-keys')
        .send({ name: 'partial', scopes: [ApiPermission.READ_MEDIA, ApiPermission.UPDATE_MEDIA] });

      expect(res.status).toBe(403);

      const rows: { count: string }[] = await TestDataSource.query(
        `SELECT COUNT(*) as count FROM "apikey" WHERE "name" = $1`,
        ['partial'],
      );
      expect(Number(rows[0]?.count)).toBe(0);
    });

    it('allows a corpus-write scope for an admin', async () => {
      signInAs(app, fixtures.users.kevin);

      const res = await request(app)
        .post('/v1/user/api-keys')
        .send({ name: 'corpus tooling', scopes: [ApiPermission.ADD_MEDIA] });

      expect(res.status).toBe(201);
      expect(await storedPermissions(res.body.id)).toEqual({ api: [ApiPermission.ADD_MEDIA] });
    });
  });

  describe('rejects malformed requests', () => {
    it('rejects an empty scope list', async () => {
      const res = await request(app).post('/v1/user/api-keys').send({ name: 'no scopes', scopes: [] });

      expect(res.status).toBe(400);
    });

    it('rejects an unknown scope', async () => {
      const res = await request(app)
        .post('/v1/user/api-keys')
        .send({ name: 'bogus', scopes: ['BECOME_ADMIN'] });

      expect(res.status).toBe(400);
    });

    it('rejects duplicate scopes', async () => {
      const res = await request(app)
        .post('/v1/user/api-keys')
        .send({ name: 'dupes', scopes: [ApiPermission.READ_MEDIA, ApiPermission.READ_MEDIA] });

      expect(res.status).toBe(400);
    });

    it('rejects a blank name', async () => {
      const res = await request(app)
        .post('/v1/user/api-keys')
        .send({ name: '   ', scopes: [ApiPermission.READ_MEDIA] });

      expect(res.status).toBe(400);
    });
  });
});
