import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';

/** This schema test catches the duplicate non-cascading `Collection` foreign key that blocks account deletion;
 * testing only `deleteUser` would miss the database constraint. */

const EMAIL = 'deletion-probe@example.test';
let pool: Pool;

beforeAll(() => {
  pool = new Pool({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });
});

afterAll(async () => {
  await pool.query('DELETE FROM "Collection" WHERE user_id IN (SELECT id FROM "User" WHERE email = $1)', [EMAIL]);
  await pool.query('DELETE FROM "User" WHERE email = $1', [EMAIL]);
  await pool.end();
});

beforeEach(async () => {
  await pool.query('DELETE FROM "Collection" WHERE user_id IN (SELECT id FROM "User" WHERE email = $1)', [EMAIL]);
  await pool.query('DELETE FROM "User" WHERE email = $1', [EMAIL]);
});

async function createUserWithCollection(): Promise<number> {
  const user = await pool.query<{ id: number }>(
    `INSERT INTO "User" (username, email, is_verified, is_active, role)
     VALUES ('deletion-probe', $1, true, true, 'USER') RETURNING id`,
    [EMAIL],
  );
  const userId = user.rows[0]?.id as number;

  await pool.query(`INSERT INTO "Collection" (user_id, name, public_id) VALUES ($1, 'probe', $2)`, [
    userId,
    `probe-${userId}`,
  ]);

  return userId;
}

describe('account deletion', () => {
  it('deletes an account that owns collections, and takes the collections with it', async () => {
    const userId = await createUserWithCollection();

    // Before the duplicate foreign key was dropped, `deleteUser` raised a `Collection_user_fkey` violation instead of
    // deleting the account.
    await expect(pool.query('DELETE FROM "User" WHERE id = $1', [userId])).resolves.toBeDefined();

    const user = await pool.query('SELECT id FROM "User" WHERE id = $1', [userId]);
    const collections = await pool.query('SELECT id FROM "Collection" WHERE user_id = $1', [userId]);
    expect(user.rowCount).toBe(0);
    expect(collections.rowCount, 'the cascade should have removed the collections').toBe(0);
  });

  /** Assert the schema constraint directly so reintroducing a non-cascading foreign key fails for the actual defect,
   * not only when this particular delete happens to run. */
  it('has exactly one foreign key from Collection to User, and it cascades', async () => {
    const { rows } = await pool.query<{ conname: string; confdeltype: string }>(
      `SELECT conname, confdeltype::text
       FROM pg_constraint
       WHERE contype = 'f'
         AND conrelid = '"Collection"'::regclass
         AND confrelid = '"User"'::regclass`,
    );

    expect(rows.map((r) => r.conname)).toEqual(['Collection_user_id_fkey']);
    // 'c' is ON DELETE CASCADE; 'a' is NO ACTION, which is what broke this.
    expect(rows[0]?.confdeltype).toBe('c');
  });
});
