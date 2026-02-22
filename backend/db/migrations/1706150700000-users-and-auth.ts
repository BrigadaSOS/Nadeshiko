import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UsersAndAuth1706150700000 implements MigrationInterface {
  name = 'UsersAndAuth1706150700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ===== USER =====
    await queryRunner.query(`
      CREATE TABLE "User" (
        "id" SERIAL PRIMARY KEY,
        "username" varchar NOT NULL,
        "email" varchar NOT NULL UNIQUE,
        "image" varchar,
        "modified_at" TIMESTAMPTZ,
        "last_login" TIMESTAMPTZ,
        "is_verified" boolean NOT NULL DEFAULT false,
        "is_active" boolean NOT NULL DEFAULT false,
        "role" user_role_enum NOT NULL DEFAULT 'USER',
        "monthly_quota_limit" integer NOT NULL DEFAULT 2500,
        "preferences" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ
      )
    `);

    // ===== API AUTH =====
    await queryRunner.query(`
      CREATE TABLE "ApiAuth" (
        "id" SERIAL PRIMARY KEY,
        "name" varchar,
        "hint" varchar,
        "token" varchar NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "user_id" integer,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ,
        CONSTRAINT "ApiAuth_user_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id")
      )
    `);

    // ===== API AUTH PERMISSION =====
    await queryRunner.query(`
      CREATE TABLE "ApiAuthPermission" (
        "id" SERIAL PRIMARY KEY,
        "api_auth_id" integer NOT NULL,
        "api_permission" api_permission_enum NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ,
        CONSTRAINT "ApiAuthPermission_apiAuth_fkey" FOREIGN KEY ("api_auth_id") REFERENCES "ApiAuth"("id")
      )
    `);

    // ===== ACCOUNT QUOTA USAGE =====
    await queryRunner.query(`
      CREATE TABLE "AccountQuotaUsage" (
        "id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL,
        "period_yyyymm" integer NOT NULL,
        "request_count" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ,
        CONSTRAINT "AccountQuotaUsage_user_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_AccountQuotaUsage_user_period" ON "AccountQuotaUsage" ("user_id", "period_yyyymm")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "AccountQuotaUsage"`);
    await queryRunner.query(`DROP TABLE "ApiAuthPermission"`);
    await queryRunner.query(`DROP TABLE "ApiAuth"`);
    await queryRunner.query(`DROP TABLE "User"`);
  }
}
