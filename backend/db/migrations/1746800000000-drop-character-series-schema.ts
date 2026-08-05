import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the abandoned character / seiyuu / series subgraph.
 *
 * These five tables were created alongside media in the original schema, but
 * their controllers, mappers and OpenAPI schemas were deleted when the public
 * spec was reworked — leaving tables that nothing writes and nothing reads. The
 * `Media.characters` and `Media.seriesEntries` relations were never loaded by
 * any query, and neither the site, the bot, nor the API ever exposed them.
 *
 * Confirmed empty before dropping: all five tables are included in the seed
 * dump taken from production (`bin/setup.ts`), and a restored dump carrying
 * 33k segments had zero rows in every one of them.
 */
export class DropCharacterSeriesSchema1746800000000 implements MigrationInterface {
  name = 'DropCharacterSeriesSchema1746800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Join tables first: they hold the foreign keys.
    await queryRunner.query(`DROP TABLE IF EXISTS "MediaCharacter"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "SeriesMedia"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "Character"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "Seiyuu"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "Series"`);
    // Only ever backed MediaCharacter.role.
    await queryRunner.query(`DROP TYPE IF EXISTS "character_role"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Shape only — the tables were empty, so there is nothing to restore.
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "character_role" AS ENUM ('MAIN', 'SUPPORTING', 'BACKGROUND');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "Seiyuu" (
        "id" SERIAL PRIMARY KEY,
        "name_ja" character varying,
        "name_en" character varying,
        "image_url" character varying,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "Character" (
        "id" SERIAL PRIMARY KEY,
        "name_ja" character varying,
        "name_en" character varying,
        "image_url" character varying,
        "seiyuu_id" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "Character_seiyuu_fkey" FOREIGN KEY ("seiyuu_id") REFERENCES "Seiyuu"("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "Series" (
        "id" SERIAL PRIMARY KEY,
        "public_id" character varying,
        "name_ja" character varying,
        "name_en" character varying,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "MediaCharacter" (
        "id" SERIAL PRIMARY KEY,
        "media_id" integer NOT NULL,
        "character_id" integer NOT NULL,
        "role" "character_role",
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "MediaCharacter_media_fkey" FOREIGN KEY ("media_id") REFERENCES "Media"("id") ON DELETE CASCADE,
        CONSTRAINT "MediaCharacter_character_fkey" FOREIGN KEY ("character_id") REFERENCES "Character"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "SeriesMedia" (
        "id" SERIAL PRIMARY KEY,
        "series_id" integer NOT NULL,
        "media_id" integer NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "SeriesMedia_series_fkey" FOREIGN KEY ("series_id") REFERENCES "Series"("id") ON DELETE CASCADE,
        CONSTRAINT "SeriesMedia_media_fkey" FOREIGN KEY ("media_id") REFERENCES "Media"("id") ON DELETE CASCADE
      )
    `);
  }
}
