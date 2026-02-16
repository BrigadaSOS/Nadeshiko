import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExternalIds1739800000000 implements MigrationInterface {
  name = 'AddExternalIds1739800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create external_source_type ENUM
    await queryRunner.query(`
      CREATE TYPE "external_source_type" AS ENUM ('ANILIST', 'IMDB', 'TVDB')
    `);

    // Create MediaExternalId table
    await queryRunner.query(`
      CREATE TABLE "MediaExternalId" (
        "media_id" integer NOT NULL,
        "source" external_source_type NOT NULL,
        "external_id" varchar NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        CONSTRAINT "PK_MediaExternalId" PRIMARY KEY ("media_id", "source"),
        CONSTRAINT "FK_MediaExternalId_Media" FOREIGN KEY ("media_id")
          REFERENCES "Media"("id") ON DELETE CASCADE
      )
    `);

    // Unique index on (source, external_id) to prevent duplicate external IDs per source
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_MediaExternalId_source_external_id"
        ON "MediaExternalId" ("source", "external_id")
    `);

    // Migrate existing anilist_id data into MediaExternalId
    await queryRunner.query(`
      INSERT INTO "MediaExternalId" ("media_id", "source", "external_id")
      SELECT id, 'ANILIST', anilist_id::text FROM "Media" WHERE anilist_id IS NOT NULL
    `);

    // Drop anilist_id column and its unique index from Media
    await queryRunner.query(`ALTER TABLE "Media" DROP COLUMN "anilist_id"`);

    // Drop anilist_episode_id column and its partial unique index from Episode
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_Episode_anilist_episode_id"`);
    await queryRunner.query(`ALTER TABLE "Episode" DROP COLUMN "anilist_episode_id"`);

    // Create a sequence for Media IDs starting after the current max
    await queryRunner.query(`
      CREATE SEQUENCE "Media_id_seq" OWNED BY "Media"."id"
    `);
    await queryRunner.query(`
      SELECT setval('"Media_id_seq"', GREATEST((SELECT MAX(id) FROM "Media"), 1))
    `);
    await queryRunner.query(`
      ALTER TABLE "Media" ALTER COLUMN "id" SET DEFAULT nextval('"Media_id_seq"')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add anilist_episode_id to Episode
    await queryRunner.query(`
      ALTER TABLE "Episode" ADD COLUMN "anilist_episode_id" integer
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_Episode_anilist_episode_id"
        ON "Episode" ("anilist_episode_id") WHERE "anilist_episode_id" IS NOT NULL
    `);

    // Re-add anilist_id to Media
    await queryRunner.query(`
      ALTER TABLE "Media" ADD COLUMN "anilist_id" integer
    `);

    // Migrate data back
    await queryRunner.query(`
      UPDATE "Media" m
      SET anilist_id = e.external_id::integer
      FROM "MediaExternalId" e
      WHERE m.id = e.media_id AND e.source = 'ANILIST'
    `);

    // Add unique constraint back
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_Media_anilist_id" ON "Media" ("anilist_id")
    `);

    // Remove sequence default and drop sequence
    await queryRunner.query(`ALTER TABLE "Media" ALTER COLUMN "id" DROP DEFAULT`);
    await queryRunner.query(`DROP SEQUENCE IF EXISTS "Media_id_seq"`);

    // Drop MediaExternalId table
    await queryRunner.query(`DROP TABLE "MediaExternalId"`);

    // Drop the enum type
    await queryRunner.query(`DROP TYPE "external_source_type"`);
  }
}
