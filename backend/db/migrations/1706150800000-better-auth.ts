import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BetterAuth1706150800000 implements MigrationInterface {
  name = 'BetterAuth1706150800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ===== SESSION =====
    await queryRunner.query(`
      CREATE TABLE "session" (
        "id" SERIAL PRIMARY KEY,
        "token" varchar NOT NULL UNIQUE,
        "user_id" integer NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "ip_address" varchar,
        "user_agent" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "session_user_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_session_user_id" ON "session" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_session_expires_at" ON "session" ("expires_at")`);

    // ===== ACCOUNT =====
    await queryRunner.query(`
      CREATE TABLE "account" (
        "id" SERIAL PRIMARY KEY,
        "account_id" varchar NOT NULL,
        "provider_id" varchar NOT NULL,
        "user_id" integer NOT NULL,
        "access_token" text,
        "refresh_token" text,
        "access_token_expires_at" TIMESTAMPTZ,
        "refresh_token_expires_at" TIMESTAMPTZ,
        "scope" text,
        "id_token" text,
        "password" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "account_user_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_account_provider" UNIQUE ("provider_id", "account_id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_account_user_id" ON "account" ("user_id")`);

    // ===== VERIFICATION =====
    await queryRunner.query(`
      CREATE TABLE "verification" (
        "id" SERIAL PRIMARY KEY,
        "identifier" varchar NOT NULL,
        "value" text NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_verification_identifier" ON "verification" ("identifier")`);

    // ===== APIKEY =====
    await queryRunner.query(`
      CREATE TABLE "apikey" (
        "id" SERIAL PRIMARY KEY,
        "name" varchar,
        "start" varchar,
        "prefix" varchar,
        "key" varchar NOT NULL UNIQUE,
        "userId" integer NOT NULL,
        "refillInterval" integer,
        "refillAmount" integer,
        "lastRefillAt" TIMESTAMPTZ,
        "enabled" boolean NOT NULL DEFAULT true,
        "rateLimitEnabled" boolean NOT NULL DEFAULT true,
        "rateLimitTimeWindow" integer NOT NULL DEFAULT 86400000,
        "rateLimitMax" integer NOT NULL DEFAULT 10,
        "requestCount" integer NOT NULL DEFAULT 0,
        "remaining" integer,
        "lastRequest" TIMESTAMPTZ,
        "expiresAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "permissions" text,
        "metadata" text,
        CONSTRAINT "apikey_user_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_apikey_userId" ON "apikey" ("userId")`);
    await queryRunner.query(`CREATE INDEX "IDX_apikey_expiresAt" ON "apikey" ("expiresAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "apikey"`);
    await queryRunner.query(`DROP TABLE "verification"`);
    await queryRunner.query(`DROP TABLE "account"`);
    await queryRunner.query(`DROP TABLE "session"`);
  }
}
