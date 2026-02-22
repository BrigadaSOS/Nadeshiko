import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MediaAndSeries1706150500000 implements MigrationInterface {
  name = 'MediaAndSeries1706150500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "Media" (
        "id" SERIAL PRIMARY KEY,
        "japanese_name" varchar NOT NULL,
        "romaji_name" varchar NOT NULL,
        "english_name" varchar NOT NULL,
        "airing_format" varchar NOT NULL,
        "airing_status" varchar NOT NULL,
        "genres" text[] NOT NULL,
        "storage" segment_storage NOT NULL DEFAULT 'R2',
        "start_date" date NOT NULL,
        "end_date" date,
        "studio" varchar NOT NULL DEFAULT 'UNKNOWN',
        "season_name" varchar NOT NULL DEFAULT 'UNKNOWN',
        "season_year" integer NOT NULL DEFAULT 0,
        "category" category_type NOT NULL DEFAULT 'ANIME',
        "num_segments" integer NOT NULL DEFAULT 0,
        "version" varchar NOT NULL,
        "hash_salt" varchar,
        "storage_base_path" varchar NOT NULL,
        "deleted_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "Episode" (
        "media_id" integer NOT NULL,
        "episode_number" integer NOT NULL,
        "title_english" text,
        "title_romaji" text,
        "title_japanese" text,
        "description" text,
        "aired_at" TIMESTAMPTZ,
        "length_seconds" integer,
        "thumbnail_url" text,
        "num_segments" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_Episode" PRIMARY KEY ("media_id", "episode_number"),
        CONSTRAINT "FK_Episode_Media" FOREIGN KEY ("media_id")
          REFERENCES "Media"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "MediaExternalId" (
        "media_id" integer NOT NULL,
        "source" external_source_type NOT NULL,
        "external_id" varchar NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ,
        CONSTRAINT "PK_MediaExternalId" PRIMARY KEY ("media_id", "source"),
        CONSTRAINT "FK_MediaExternalId_Media" FOREIGN KEY ("media_id")
          REFERENCES "Media"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_MediaExternalId_source_external_id"
        ON "MediaExternalId" ("source", "external_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "Seiyuu" (
        "id" SERIAL PRIMARY KEY,
        "external_ids" jsonb NOT NULL DEFAULT '{}',
        "name_japanese" varchar NOT NULL,
        "name_english" varchar NOT NULL,
        "image_url" varchar NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_Seiyuu_anilist_id"
      ON "Seiyuu" ((external_ids->>'anilist'))
      WHERE external_ids->>'anilist' IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "Character" (
        "id" SERIAL PRIMARY KEY,
        "external_ids" jsonb NOT NULL DEFAULT '{}',
        "name_japanese" varchar NOT NULL,
        "name_english" varchar NOT NULL,
        "image_url" varchar NOT NULL,
        "seiyuu_id" integer NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ,
        CONSTRAINT "Character_seiyuu_fkey" FOREIGN KEY ("seiyuu_id") REFERENCES "Seiyuu"("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_Character_seiyuu_id" ON "Character" ("seiyuu_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_Character_anilist_id"
      ON "Character" ((external_ids->>'anilist'))
      WHERE external_ids->>'anilist' IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "MediaCharacter" (
        "id" SERIAL PRIMARY KEY,
        "media_id" integer NOT NULL,
        "character_id" integer NOT NULL,
        "role" character_role NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ,
        CONSTRAINT "MediaCharacter_media_fkey" FOREIGN KEY ("media_id") REFERENCES "Media"("id") ON DELETE CASCADE,
        CONSTRAINT "MediaCharacter_character_fkey" FOREIGN KEY ("character_id") REFERENCES "Character"("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_MediaCharacter_media_character" ON "MediaCharacter" ("media_id", "character_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "Series" (
        "id" SERIAL PRIMARY KEY,
        "name_japanese" varchar NOT NULL,
        "name_romaji" varchar NOT NULL,
        "name_english" varchar NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "SeriesMedia" (
        "id" SERIAL PRIMARY KEY,
        "series_id" integer NOT NULL,
        "media_id" integer NOT NULL,
        "position" integer NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ,
        CONSTRAINT "SeriesMedia_series_fkey" FOREIGN KEY ("series_id") REFERENCES "Series"("id") ON DELETE CASCADE,
        CONSTRAINT "SeriesMedia_media_fkey" FOREIGN KEY ("media_id") REFERENCES "Media"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_series_media_series_media" ON "SeriesMedia" ("series_id", "media_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_series_media_series_position" ON "SeriesMedia" ("series_id", "position")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "SeriesMedia"`);
    await queryRunner.query(`DROP TABLE "Series"`);
    await queryRunner.query(`DROP INDEX "IDX_MediaCharacter_media_character"`);
    await queryRunner.query(`DROP TABLE "MediaCharacter"`);
    await queryRunner.query(`DROP INDEX "IDX_Character_anilist_id"`);
    await queryRunner.query(`DROP INDEX "IDX_Character_seiyuu_id"`);
    await queryRunner.query(`DROP TABLE "Character"`);
    await queryRunner.query(`DROP INDEX "IDX_Seiyuu_anilist_id"`);
    await queryRunner.query(`DROP TABLE "Seiyuu"`);
    await queryRunner.query(`DROP INDEX "IDX_MediaExternalId_source_external_id"`);
    await queryRunner.query(`DROP TABLE "MediaExternalId"`);
    await queryRunner.query(`DROP TABLE "Episode"`);
    await queryRunner.query(`DROP TABLE "Media"`);
  }
}
