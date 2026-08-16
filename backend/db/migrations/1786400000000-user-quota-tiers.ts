import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Named quota levels, so raising someone's allowance stops being an UPDATE
 * against production.
 *
 * The state this replaces: 613 accounts on `monthly_quota_limit = 5000` and one
 * on 10000, that one set by hand after a support email. The number was the only
 * record of the decision, which made it unreviewable -- there was no way to ask
 * "who is on a raised limit and why", and no way to move a group of accounts
 * together.
 *
 * Nothing changes for anyone in this migration, deliberately. Every account
 * lands on `free` (5000, the default they already had), and the single account
 * that differs is written as an explicit `quota_override` holding the same
 * number it has now. The override is the honest home for it: it was never a
 * tier, it was an exception, and it keeps behaving as one until somebody
 * decides which tier it belongs on.
 *
 * `monthly_quota_limit` is left in place and left populated. Dropping it here
 * would mean this migration decides the limit for 614 accounts from a mapping
 * invented in it; the resolver reads it as the last fallback instead, so an
 * account whose tier goes missing keeps the number it has always had rather
 * than dropping to a built-in default.
 *
 * `plus` and `pro` are seeded because a tier table with one row is a column
 * with extra steps -- the point is that the next bump is a tier reference. The
 * burst allowances are null on every seeded tier, meaning "inherit
 * API_KEY_RATE_LIMIT_MAX": raising the monthly number should not quietly also
 * raise the per-minute one.
 */
export class UserQuotaTiers1786400000000 implements MigrationInterface {
  name = 'UserQuotaTiers1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "Tier" (
        "id" text PRIMARY KEY,
        "display_name" text NOT NULL,
        "monthly_quota_limit" integer NOT NULL,
        "rate_limit_max" integer,
        "rate_limit_window_ms" integer,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP DEFAULT now()
      )
    `);

    await queryRunner.query(`
      INSERT INTO "Tier" ("id", "display_name", "monthly_quota_limit", "sort_order") VALUES
        ('free', 'Free',   5000,  0),
        ('plus', 'Plus',   25000, 10),
        ('pro',  'Pro',    100000, 20)
    `);

    // ON DELETE SET NULL rather than RESTRICT: deleting a tier is a mistake we
    // want to be able to recover from without the delete failing halfway
    // through, and the resolver already treats a dangling tier as "fall back
    // and warn" rather than as an error.
    await queryRunner.query(`
      ALTER TABLE "User"
        ADD COLUMN "tier_id" text DEFAULT 'free' REFERENCES "Tier"("id") ON DELETE SET NULL,
        ADD COLUMN "quota_override" integer
    `);

    // The DEFAULT above only applies to rows inserted after it; existing rows
    // are stamped explicitly.
    await queryRunner.query(`UPDATE "User" SET "tier_id" = 'free' WHERE "tier_id" IS NULL`);

    // Anyone already off the default keeps their exact number, now recorded as
    // the exception it is. Written from the column rather than from a hardcoded
    // list so it holds whatever production actually has at migration time.
    await queryRunner.query(`
      UPDATE "User"
         SET "quota_override" = "monthly_quota_limit"
       WHERE "monthly_quota_limit" IS DISTINCT FROM 5000
    `);

    await queryRunner.query(`CREATE INDEX "IDX_user_tier_id" ON "User" ("tier_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The override is folded back into the column it came from, so an account
    // that was raised stays raised after a rollback.
    await queryRunner.query(`
      UPDATE "User"
         SET "monthly_quota_limit" = "quota_override"
       WHERE "quota_override" IS NOT NULL
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_tier_id"`);
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "quota_override", DROP COLUMN "tier_id"`);
    await queryRunner.query(`DROP TABLE "Tier"`);
  }
}
