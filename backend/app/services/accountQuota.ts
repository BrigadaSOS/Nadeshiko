import { AppDataSource } from '@config/database';
import { AuthCredentialsInvalidError } from '@lib/utils/apiErrors';

export const DEFAULT_MONTHLY_QUOTA_LIMIT = 2500;

export interface AccountQuotaSnapshot {
  periodYyyymm: number;
  quotaLimit: number;
  quotaUsed: number;
  quotaRemaining: number;
}

export function getCurrentQuotaPeriodYyyymm(date = new Date()): number {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return year * 100 + month;
}

export function getQuotaWindow(periodYyyymm = getCurrentQuotaPeriodYyyymm()): {
  periodStart: string;
  periodEnd: string;
} {
  const year = Math.floor(periodYyyymm / 100);
  const month = periodYyyymm % 100;
  const periodStartDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const periodEndDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  return {
    periodStart: periodStartDate.toISOString(),
    periodEnd: periodEndDate.toISOString(),
  };
}

function parseInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export async function incrementAndGetUserQuota(userId: number): Promise<AccountQuotaSnapshot> {
  const periodYyyymm = getCurrentQuotaPeriodYyyymm();
  const rows = (await AppDataSource.query(
    `
      WITH user_limit AS (
        SELECT "id", "monthly_quota_limit"
        FROM "User"
        WHERE "id" = $1 AND "is_active" = true
      ),
      upsert AS (
        INSERT INTO "AccountQuotaUsage" ("user_id", "period_yyyymm", "request_count", "created_at", "updated_at")
        SELECT "id", $2, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM user_limit
        ON CONFLICT ("user_id", "period_yyyymm")
        DO UPDATE SET
          "request_count" = "AccountQuotaUsage"."request_count" + 1,
          "updated_at" = CURRENT_TIMESTAMP
        RETURNING "request_count"
      )
      SELECT
        COALESCE(user_limit."monthly_quota_limit", $3) AS "quota_limit",
        upsert."request_count" AS "quota_used"
      FROM user_limit
      JOIN upsert ON true;
    `,
    [userId, periodYyyymm, DEFAULT_MONTHLY_QUOTA_LIMIT],
  )) as Array<{ quota_limit: string | number; quota_used: string | number }>;

  if (rows.length === 0) {
    throw new AuthCredentialsInvalidError('User is invalid or inactive.');
  }

  const quotaLimit = parseInteger(rows[0].quota_limit, DEFAULT_MONTHLY_QUOTA_LIMIT);
  const quotaUsed = parseInteger(rows[0].quota_used, 0);

  return {
    periodYyyymm,
    quotaLimit,
    quotaUsed,
    quotaRemaining: Math.max(quotaLimit - quotaUsed, 0),
  };
}

export async function getUserQuota(userId: number): Promise<AccountQuotaSnapshot> {
  const periodYyyymm = getCurrentQuotaPeriodYyyymm();
  const rows = (await AppDataSource.query(
    `
      SELECT
        COALESCE(u."monthly_quota_limit", $2) AS "quota_limit",
        COALESCE(usage."request_count", 0) AS "quota_used"
      FROM "User" u
      LEFT JOIN "AccountQuotaUsage" usage
        ON usage."user_id" = u."id"
       AND usage."period_yyyymm" = $1
      WHERE u."id" = $3 AND u."is_active" = true;
    `,
    [periodYyyymm, DEFAULT_MONTHLY_QUOTA_LIMIT, userId],
  )) as Array<{ quota_limit: string | number; quota_used: string | number }>;

  if (rows.length === 0) {
    throw new AuthCredentialsInvalidError('User is invalid or inactive.');
  }

  const quotaLimit = parseInteger(rows[0].quota_limit, DEFAULT_MONTHLY_QUOTA_LIMIT);
  const quotaUsed = parseInteger(rows[0].quota_used, 0);

  return {
    periodYyyymm,
    quotaLimit,
    quotaUsed,
    quotaRemaining: Math.max(quotaLimit - quotaUsed, 0),
  };
}
