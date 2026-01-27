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
        "id" SERIAL PRIMARY KEY,
        "anilist_id" integer NOT NULL,
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
        "num_episodes" integer DEFAULT 0 NOT NULL,
        "version" varchar NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp
      );
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
        CONSTRAINT "Segment_media_fkey" FOREIGN KEY ("media_id") REFERENCES "Media"("id")
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse order (due to foreign keys)

    // API domain tables
    await queryRunner.query(`DROP TABLE "ApiAuthPermission";`);
    await queryRunner.query(`DROP TABLE "ApiAuth";`);

    // Media domain tables
    await queryRunner.query(`DROP TABLE "Segment";`);
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
