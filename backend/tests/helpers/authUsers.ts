import { auth } from '@config/auth';

/** Delete a better-auth user and dependent rows explicitly: its `pg.Pool` is outside TypeORM per-test transaction
 * rollback. */
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
