import type { NextFunction, Request, Response } from 'express';
import { AppDataSource } from '@config/database';

export const getAdminUsersWithProviders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const searchCondition = search ? `AND (u.email ILIKE $3 OR u.username ILIKE $3)` : '';
    const params: (string | number)[] = [limit, offset];
    if (search) params.push(`%${search}%`);

    const rows = await AppDataSource.query(
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

    res.json({ users: rows, total: Number(count) });
  } catch (err) {
    next(err);
  }
};
