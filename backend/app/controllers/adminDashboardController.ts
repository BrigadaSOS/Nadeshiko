import type { GetAdminUsersWithProviders } from 'generated/routes/admin';
import type { t_AdminUserWithProviders } from 'generated/models';
import { UserRoleType } from '@app/models';
import { AppDataSource } from '@config/database';

interface AdminUserRow {
  id: number;
  name: string | null;
  email: string;
  role: UserRoleType;
  emailVerified: boolean;
  banned: boolean;
  banReason: string | null;
  createdAt: Date;
  updatedAt: Date | null;
  providers: string[];
}

function toAdminUserDTO(row: AdminUserRow): t_AdminUserWithProviders {
  return {
    id: row.id,
    name: row.name ?? '',
    email: row.email,
    role: row.role,
    emailVerified: row.emailVerified,
    banned: row.banned,
    banReason: row.banReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: (row.updatedAt ?? row.createdAt).toISOString(),
    providers: row.providers,
  };
}

export const getAdminUsersWithProviders: GetAdminUsersWithProviders = async ({ query }, respond) => {
  const search = query.search?.trim() ?? '';

  const searchCondition = search ? `AND (u.email ILIKE $3 OR u.username ILIKE $3)` : '';
  const params: (string | number)[] = [query.limit, query.offset];
  if (search) params.push(`%${search}%`);

  const rows: AdminUserRow[] = await AppDataSource.query(
    `SELECT
        u.id,
        u.username AS name,
        u.email,
        u.role,
        u.is_verified AS "emailVerified",
        u.banned,
        u.ban_reason AS "banReason",
        u.created_at AS "createdAt",
        u.modified_at AS "updatedAt",
        COALESCE(
          array_agg(DISTINCT a.provider_id) FILTER (WHERE a.provider_id IS NOT NULL),
          ARRAY[]::text[]
        ) AS providers
      FROM "User" u
      LEFT JOIN account a ON a.user_id = u.id
      WHERE u.is_active = true ${searchCondition}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2`,
    params,
  );

  const [{ count }] = await AppDataSource.query(
    `SELECT COUNT(*) AS count FROM "User" u WHERE u.is_active = true ${search ? 'AND (u.email ILIKE $1 OR u.username ILIKE $1)' : ''}`,
    search ? [`%${search}%`] : [],
  );

  return respond.with200().body({
    users: rows.map(toAdminUserDTO),
    total: Number(count),
  });
};
