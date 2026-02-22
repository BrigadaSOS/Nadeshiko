import { auth } from '@config/auth';

/**
 * Deletes a better-auth user and all their dependent rows (sessions, accounts).
 *
 * better-auth uses its own pg.Pool — rows it creates are not covered by
 * TypeORM's per-test transaction rollback and must be cleaned up explicitly.
 */
export async function deleteAuthUserByEmail(email: string): Promise<void> {
  const ctx = await auth.$context;
  const user = await ctx.adapter.findOne<{ id: string }>({
    model: 'user',
    where: [{ field: 'email', value: email }],
  });
  if (!user) return;
  await ctx.adapter.delete({ model: 'session', where: [{ field: 'userId', value: user.id }] }).catch(() => {});
  await ctx.adapter.delete({ model: 'account', where: [{ field: 'userId', value: user.id }] }).catch(() => {});
  await ctx.adapter.delete({ model: 'user', where: [{ field: 'id', value: user.id }] }).catch(() => {});
}
