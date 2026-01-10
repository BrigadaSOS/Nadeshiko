import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1706150400000 implements MigrationInterface {
  name = 'InitialSchema1706150400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum types
    await queryRunner.query(`
      CREATE TYPE "api_permission_enum" AS ENUM (
        'ADD_MEDIA',
        'READ_MEDIA',
        'REMOVE_MEDIA',
        'UPDATE_MEDIA',
        'WRITE_MEDIA',
        'RESYNC_DATABASE',
        'CREATE_USER'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "category_type" AS ENUM (
        'ANIME',
        'BOOK',
        'JDRAMA',
        'AUDIOBOOK'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "Role" (
        "id" integer PRIMARY KEY,
        "name" varchar NOT NULL,
        "description" varchar,
        "quota_limit" integer DEFAULT 2500 NOT NULL
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "User" (
        "id" SERIAL PRIMARY KEY,
        "username" varchar NOT NULL,
        "email" varchar NOT NULL UNIQUE,
        "password" varchar,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "modified_at" timestamp,
        "last_login" timestamp,
        "is_verified" boolean DEFAULT false NOT NULL,
        "is_active" boolean DEFAULT false NOT NULL
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
      CREATE TABLE "UserAuth" (
        "id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL,
        "provider" varchar NOT NULL,
        "provider_user_id" varchar NOT NULL,
        CONSTRAINT "UserAuth_user_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "UserToken" (
        "id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL,
        "token" varchar NOT NULL UNIQUE,
        "type" varchar DEFAULT 'PASSWORD_RESET' NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        CONSTRAINT "UserToken_user_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id")
      );
    `);

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
        "cover_url" varchar NOT NULL,
        "banner_url" varchar NOT NULL,
        "release_date" varchar NOT NULL,
        "category" category_type DEFAULT 'ANIME' NOT NULL,
        "num_segments" integer DEFAULT 0 NOT NULL,
        "version" varchar NOT NULL,
        "hash_salt" varchar,
        "deleted_at" timestamp,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp
      );
    `);

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
        "content_spanish" varchar(500),
        "content_spanish_mt" boolean DEFAULT false NOT NULL,
        "content_english" varchar(500),
        "content_english_mt" boolean DEFAULT false NOT NULL,
        "is_nsfw" boolean DEFAULT false NOT NULL,
        "image_url" varchar,
        "audio_url" varchar,
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

    // API domain tables
    await queryRunner.query(`DROP TABLE "ApiAuthPermission";`);
    await queryRunner.query(`DROP TABLE "ApiAuth";`);

    // Media domain tables
    await queryRunner.query(`DROP TABLE "Segment";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_Episode_anilist_episode_id";`);
    await queryRunner.query(`DROP TABLE "Episode";`);
    await queryRunner.query(`DROP TABLE "Media";`);

    // User domain tables
    await queryRunner.query(`DROP TABLE "UserToken";`);
    await queryRunner.query(`DROP TABLE "UserAuth";`);
    await queryRunner.query(`DROP TABLE "UserRole";`);
    await queryRunner.query(`DROP TABLE "User";`);
    await queryRunner.query(`DROP TABLE "Role";`);

    // Drop enum types
    await queryRunner.query(`DROP TYPE "api_permission_enum";`);
    await queryRunner.query(`DROP TYPE "category_type";`);
  }
}
