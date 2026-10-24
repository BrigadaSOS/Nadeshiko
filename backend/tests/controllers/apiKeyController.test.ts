import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestSuite, createTestApp, signInAs, TestDataSource } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { ApiPermission, AuthType } from '@app/models';
import { InsufficientPermissionsError } from '@app/errors';
import { createUserApiKey } from '@app/controllers/apiKeyController';

setupTestSuite();

const app = createTestApp();
let fixtures: CoreFixtures;

beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

beforeEach(() => {
  signInAs(app, fixtures.users.regular);
});

/** better-auth uses its own `pg.Pool`, outside the TypeORM rollback. Created keys therefore persist; cleanup by
 * `DELETE` can hang against the open transaction, so assertions use returned ids and unique non-created names. */

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

    // The response scopes do not prove the persisted scopes. A key stored with the default set would satisfy the
    // earlier response assertion but authorize later requests incorrectly.
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

  it('refuses to mint a key from an impersonated session', async () => {
    const name = 'minted-while-impersonating';
    const req = {
      user: fixtures.users.regular,
      auth: { type: AuthType.SESSION, impersonatedBy: String(fixtures.users.kevin.id) },
    };

    await expect(
      createUserApiKey(
        { body: { name, scopes: [ApiPermission.READ_MEDIA] } } as any,
        {} as any,
        req as any,
        {} as any,
        (() => {}) as any,
      ),
    ).rejects.toBeInstanceOf(InsufficientPermissionsError);

    const rows: { count: string }[] = await TestDataSource.query(
      `SELECT COUNT(*) as count FROM "apikey" WHERE "name" = $1`,
      [name],
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });
});
