import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1706150400000 implements MigrationInterface {
  name = 'InitialSchema1706150400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ===== ENUM TYPES =====
    await queryRunner.query(`
      CREATE TYPE "api_permission_enum" AS ENUM (
        'ADD_MEDIA',
        'READ_MEDIA',
        'REMOVE_MEDIA',
        'UPDATE_MEDIA',
        'READ_LISTS',
        'CREATE_LISTS',
        'UPDATE_LISTS',
        'DELETE_LISTS'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "category_type" AS ENUM (
        'ANIME',
        'JDRAMA'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "character_role" AS ENUM (
        'MAIN',
        'SUPPORTING',
        'BACKGROUND'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "list_type" AS ENUM (
        'SERIES',
        'CUSTOM'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "list_visibility" AS ENUM (
        'PUBLIC',
        'PRIVATE'
      );
    `);

    // ===== BASE TABLES =====
    await queryRunner.query(`
      CREATE TABLE "Role" (
        "id" integer PRIMARY KEY,
        "name" varchar NOT NULL,
        "description" varchar
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "User" (
        "id" SERIAL PRIMARY KEY,
        "username" varchar NOT NULL,
        "email" varchar NOT NULL UNIQUE,
        "image" varchar,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "modified_at" timestamp,
        "last_login" timestamp,
        "is_verified" boolean DEFAULT false NOT NULL,
        "is_active" boolean DEFAULT false NOT NULL,
        "monthly_quota_limit" bigint DEFAULT 2500 NOT NULL
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "UserRole" (
        "id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL,
        "role_id" integer NOT NULL,
        CONSTRAINT "UserRole_user_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id"),
        CONSTRAINT "UserRole_role_fkey" FOREIGN KEY ("role_id") REFERENCES "Role"("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "session" (
        "id" SERIAL PRIMARY KEY,
        "token" varchar NOT NULL UNIQUE,
        "user_id" integer NOT NULL,
        "expires_at" timestamp NOT NULL,
        "ip_address" varchar,
        "user_agent" text,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "session_user_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_session_user_id" ON "session" ("user_id");
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_session_expires_at" ON "session" ("expires_at");
    `);

    await queryRunner.query(`
      CREATE TABLE "account" (
        "id" SERIAL PRIMARY KEY,
        "account_id" varchar NOT NULL,
        "provider_id" varchar NOT NULL,
        "user_id" integer NOT NULL,
        "access_token" text,
        "refresh_token" text,
        "access_token_expires_at" timestamp,
        "refresh_token_expires_at" timestamp,
        "scope" text,
        "id_token" text,
        "password" text,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "account_user_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_account_provider" UNIQUE ("provider_id", "account_id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_account_user_id" ON "account" ("user_id");
    `);

    await queryRunner.query(`
      CREATE TABLE "verification" (
        "id" SERIAL PRIMARY KEY,
        "identifier" varchar NOT NULL,
        "value" text NOT NULL,
        "expires_at" timestamp NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_verification_identifier" ON "verification" ("identifier");
    `);

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
        "lastRefillAt" timestamp,
        "enabled" boolean DEFAULT true NOT NULL,
        "rateLimitEnabled" boolean DEFAULT true NOT NULL,
        "rateLimitTimeWindow" integer DEFAULT 86400000 NOT NULL,
        "rateLimitMax" integer DEFAULT 10 NOT NULL,
        "requestCount" integer DEFAULT 0 NOT NULL,
        "remaining" integer,
        "lastRequest" timestamp,
        "expiresAt" timestamp,
        "createdAt" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updatedAt" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "permissions" text,
        "metadata" text,
        CONSTRAINT "apikey_user_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_apikey_userId" ON "apikey" ("userId");
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_apikey_expiresAt" ON "apikey" ("expiresAt");
    `);

    // ===== MEDIA TABLES =====
    await queryRunner.query(`
      CREATE TABLE "Media" (
        "id" integer PRIMARY KEY,
        "anilist_id" integer NOT NULL UNIQUE,
        "japanese_name" varchar NOT NULL,
        "romaji_name" varchar NOT NULL,
        "english_name" varchar NOT NULL,
        "airing_format" varchar NOT NULL,
        "airing_status" varchar NOT NULL,
        "genres" text[] NOT NULL,
        "start_date" date NOT NULL,
        "end_date" date,
        "category" category_type DEFAULT 'ANIME' NOT NULL,
        "num_segments" integer DEFAULT 0 NOT NULL,
        "version" varchar NOT NULL,
        "hash_salt" varchar,
        "studio" varchar NOT NULL DEFAULT 'UNKNOWN',
        "season_name" varchar NOT NULL DEFAULT 'UNKNOWN',
        "season_year" integer NOT NULL DEFAULT 0,
        "storage" varchar NOT NULL DEFAULT 'r2',
        "deleted_at" timestamp,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "Seiyuu" (
        "id" integer PRIMARY KEY,
        "name_japanese" varchar NOT NULL,
        "name_english" varchar NOT NULL,
        "image_url" varchar NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "Character" (
        "id" integer PRIMARY KEY,
        "name_japanese" varchar NOT NULL,
        "name_english" varchar NOT NULL,
        "image_url" varchar NOT NULL,
        "seiyuu_id" integer NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp,
        CONSTRAINT "Character_seiyuu_fkey" FOREIGN KEY ("seiyuu_id") REFERENCES "Seiyuu"("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_Character_seiyuu_id" ON "Character" ("seiyuu_id");
    `);

    await queryRunner.query(`
      CREATE TABLE "MediaCharacter" (
        "id" SERIAL PRIMARY KEY,
        "media_id" integer NOT NULL,
        "character_id" integer NOT NULL,
        "role" character_role NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp,
        CONSTRAINT "MediaCharacter_media_fkey" FOREIGN KEY ("media_id") REFERENCES "Media"("id") ON DELETE CASCADE,
        CONSTRAINT "MediaCharacter_character_fkey" FOREIGN KEY ("character_id") REFERENCES "Character"("id")
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_MediaCharacter_media_character" ON "MediaCharacter" ("media_id", "character_id");
    `);

    // ===== EPISODE TABLE =====
    await queryRunner.query(`
      CREATE TABLE "Episode" (
        "media_id" integer NOT NULL,
        "episode_number" integer NOT NULL,
        "anilist_episode_id" integer,
        "title_english" text,
        "title_romaji" text,
        "title_japanese" text,
        "description" text,
        "aired_at" TIMESTAMP WITH TIME ZONE,
        "length_seconds" integer,
        "thumbnail_url" text,
        "num_segments" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_Episode" PRIMARY KEY ("media_id", "episode_number"),
        CONSTRAINT "FK_Episode_Media" FOREIGN KEY ("media_id")
          REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_Episode_anilist_episode_id"
      ON "Episode" ("anilist_episode_id")
      WHERE "anilist_episode_id" IS NOT NULL;
    `);

    // ===== SEGMENT TABLE =====
    await queryRunner.query(`
      CREATE TABLE "Segment" (
        "id" SERIAL PRIMARY KEY,
        "uuid" varchar NOT NULL UNIQUE,
        "position" integer NOT NULL,
        "status" smallint DEFAULT 1 NOT NULL,
        "start_time" varchar NOT NULL,
        "end_time" varchar NOT NULL,
        "content" varchar(500) NOT NULL,
        "content_length" integer NOT NULL,
        "content_spanish" varchar(500) NOT NULL,
        "content_spanish_mt" boolean DEFAULT false NOT NULL,
        "content_english" varchar(500) NOT NULL,
        "content_english_mt" boolean DEFAULT false NOT NULL,
        "is_nsfw" boolean DEFAULT false NOT NULL,
        "storage" varchar NOT NULL DEFAULT 'r2',
        "hashed_id" varchar NOT NULL,
        "actor_ja" varchar,
        "actor_es" varchar,
        "actor_en" varchar,
        "media_id" integer NOT NULL,
        "episode" smallint NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "Segment_media_fkey" FOREIGN KEY ("media_id") REFERENCES "Media"("id"),
        CONSTRAINT "Segment_episode_fkey" FOREIGN KEY ("media_id", "episode")
          REFERENCES "Episode"("media_id", "episode_number") ON DELETE CASCADE ON UPDATE NO ACTION
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_Segment_media_episode" ON "Segment" ("media_id", "episode");
    `);

    // ===== LIST TABLES =====
    await queryRunner.query(`
      CREATE TABLE "List" (
        "id" SERIAL PRIMARY KEY,
        "name" varchar NOT NULL,
        "type" list_type NOT NULL,
        "user_id" integer NOT NULL,
        "visibility" list_visibility DEFAULT 'PRIVATE' NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp,
        CONSTRAINT "List_user_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_List_user_id" ON "List" ("user_id");
    `);

    await queryRunner.query(`
      CREATE TABLE "ListItem" (
        "id" SERIAL PRIMARY KEY,
        "list_id" integer NOT NULL,
        "media_id" integer NOT NULL,
        "position" integer NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp,
        CONSTRAINT "ListItem_list_fkey" FOREIGN KEY ("list_id") REFERENCES "List"("id") ON DELETE CASCADE,
        CONSTRAINT "ListItem_media_fkey" FOREIGN KEY ("media_id") REFERENCES "Media"("id")
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_ListItem_list_media" ON "ListItem" ("list_id", "media_id");
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_ListItem_media_id" ON "ListItem" ("media_id");
    `);

    // ===== API AUTH TABLES =====
    await queryRunner.query(`
      CREATE TABLE "ApiAuth" (
        "id" SERIAL PRIMARY KEY,
        "name" varchar NOT NULL,
        "hint" varchar NOT NULL,
        "token" varchar NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "user_id" integer NOT NULL,
        CONSTRAINT "ApiAuth_user_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "ApiAuthPermission" (
        "id" SERIAL PRIMARY KEY,
        "api_auth_id" integer NOT NULL,
        "api_permission" api_permission_enum NOT NULL,
        CONSTRAINT "ApiAuthPermission_apiAuth_fkey" FOREIGN KEY ("api_auth_id") REFERENCES "ApiAuth"("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "AccountQuotaUsage" (
        "id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL,
        "period_yyyymm" integer NOT NULL,
        "request_count" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AccountQuotaUsage_user_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_AccountQuotaUsage_user_period" ON "AccountQuotaUsage" ("user_id", "period_yyyymm");
    `);

    // ===== DATA MIGRATION =====
    // Migrate existing data: Create Episode records from Segments
    await queryRunner.query(`
      INSERT INTO "Episode" (
        "media_id",
        "episode_number",
        "num_segments"
      )
      SELECT
        s."media_id",
        s."episode",
        COUNT(*) as num_segments
      FROM "Segment" s
      WHERE s."status" != 0
      GROUP BY s."media_id", s."episode"
      ORDER BY s."media_id", s."episode";
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse order (due to foreign keys)

    // API auth tables
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_AccountQuotaUsage_user_period";`);
    await queryRunner.query(`DROP TABLE "AccountQuotaUsage";`);
    await queryRunner.query(`DROP TABLE "ApiAuthPermission";`);
    await queryRunner.query(`DROP TABLE "ApiAuth";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_apikey_expiresAt";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_apikey_userId";`);
    await queryRunner.query(`DROP TABLE "apikey";`);

    // List tables
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ListItem_media_id";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ListItem_list_media";`);
    await queryRunner.query(`DROP TABLE "ListItem";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_List_user_id";`);
    await queryRunner.query(`DROP TABLE "List";`);

    // Segment table
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_Segment_media_episode";`);
    await queryRunner.query(`DROP TABLE "Segment";`);

    // Episode table
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_Episode_anilist_episode_id";`);
    await queryRunner.query(`DROP TABLE "Episode";`);

    // Character tables
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_MediaCharacter_media_character";`);
    await queryRunner.query(`DROP TABLE "MediaCharacter";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_Character_seiyuu_id";`);
    await queryRunner.query(`DROP TABLE "Character";`);
    await queryRunner.query(`DROP TABLE "Seiyuu";`);

    // Media table
    await queryRunner.query(`DROP TABLE "Media";`);

    // User domain tables
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_verification_identifier";`);
    await queryRunner.query(`DROP TABLE "verification";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_account_user_id";`);
    await queryRunner.query(`DROP TABLE "account";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_session_expires_at";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_session_user_id";`);
    await queryRunner.query(`DROP TABLE "session";`);
    await queryRunner.query(`DROP TABLE "UserRole";`);
    await queryRunner.query(`DROP TABLE "User";`);
    await queryRunner.query(`DROP TABLE "Role";`);

    // Drop enum types
    await queryRunner.query(`DROP TYPE "api_permission_enum";`);
    await queryRunner.query(`DROP TYPE "list_visibility";`);
    await queryRunner.query(`DROP TYPE "list_type";`);
    await queryRunner.query(`DROP TYPE "character_role";`);
    await queryRunner.query(`DROP TYPE "category_type";`);
  }
}
