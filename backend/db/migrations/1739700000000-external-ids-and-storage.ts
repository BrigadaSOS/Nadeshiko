import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExternalIdsAndStorage1739700000000 implements MigrationInterface {
  name = 'ExternalIdsAndStorage1739700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ===== EXTERNAL IDS =====
    await queryRunner.query(`CREATE TYPE external_source_type AS ENUM ('ANILIST', 'IMDB', 'TVDB')`);

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
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_MediaExternalId_source_external_id"
        ON "MediaExternalId" ("source", "external_id")
    `);

    // Migrate existing anilist_id data, then drop old columns
    await queryRunner.query(`
      INSERT INTO "MediaExternalId" ("media_id", "source", "external_id")
      SELECT id, 'ANILIST', anilist_id::text FROM "Media" WHERE anilist_id IS NOT NULL
    `);
    await queryRunner.query(`ALTER TABLE "Media" DROP COLUMN "anilist_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_Episode_anilist_episode_id"`);
    await queryRunner.query(`ALTER TABLE "Episode" DROP COLUMN "anilist_episode_id"`);

    // Add auto-increment sequence for Media IDs
    await queryRunner.query(`CREATE SEQUENCE "Media_id_seq" OWNED BY "Media"."id"`);
    await queryRunner.query(`
      WITH media_max AS (
        SELECT MAX(id) AS max_id
        FROM "Media"
      )
      SELECT setval(
        '"Media_id_seq"',
        COALESCE((SELECT max_id FROM media_max), 1),
        (SELECT max_id IS NOT NULL FROM media_max)
      )
    `);
    await queryRunner.query(`ALTER TABLE "Media" ALTER COLUMN "id" SET DEFAULT nextval('"Media_id_seq"')`);

    // ===== STORAGE CHANGES =====
    // Convert Media.storage from varchar to segment_storage enum
    await queryRunner.query(`ALTER TABLE "Media" ALTER COLUMN storage DROP DEFAULT`);
    await queryRunner.query(`
      ALTER TABLE "Media"
      ALTER COLUMN storage TYPE segment_storage
      USING (UPPER(storage))::segment_storage
    `);
    await queryRunner.query(`ALTER TABLE "Media" ALTER COLUMN storage SET DEFAULT 'R2'`);

    // Add storage_base_path to Media
    await queryRunner.query(`ALTER TABLE "Media" ADD COLUMN "storage_base_path" varchar NULL`);
    await queryRunner.query(`UPDATE "Media" SET storage_base_path = 'media/' || id`);
    await queryRunner.query(`ALTER TABLE "Media" ALTER COLUMN "storage_base_path" SET NOT NULL`);

    // Add storage_base_path to Segment
    await queryRunner.query(`ALTER TABLE "Segment" ADD COLUMN "storage_base_path" varchar NULL`);
    await queryRunner.query(`
      UPDATE "Segment"
      SET storage_base_path = (
        SELECT storage_base_path FROM "Media" WHERE "Media".id = "Segment".media_id
      )
    `);
    await queryRunner.query(`ALTER TABLE "Segment" ALTER COLUMN "storage_base_path" SET NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert storage_base_path
    await queryRunner.query(`ALTER TABLE "Segment" DROP COLUMN "storage_base_path"`);
    await queryRunner.query(`ALTER TABLE "Media" DROP COLUMN "storage_base_path"`);

    // Revert Media.storage to varchar
    await queryRunner.query(`ALTER TABLE "Media" ALTER COLUMN storage DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "Media" ALTER COLUMN storage TYPE varchar USING storage::text`);
    await queryRunner.query(`ALTER TABLE "Media" ALTER COLUMN storage SET DEFAULT 'r2'`);

    // Revert Media ID sequence
    await queryRunner.query(`ALTER TABLE "Media" ALTER COLUMN "id" DROP DEFAULT`);
    await queryRunner.query(`DROP SEQUENCE IF EXISTS "Media_id_seq"`);

    // Restore anilist columns
    await queryRunner.query(`ALTER TABLE "Episode" ADD COLUMN "anilist_episode_id" integer`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_Episode_anilist_episode_id"
        ON "Episode" ("anilist_episode_id") WHERE "anilist_episode_id" IS NOT NULL
    `);
    await queryRunner.query(`ALTER TABLE "Media" ADD COLUMN "anilist_id" integer`);
    await queryRunner.query(`
      UPDATE "Media" m
      SET anilist_id = e.external_id::integer
      FROM "MediaExternalId" e
      WHERE m.id = e.media_id AND e.source = 'ANILIST'
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_Media_anilist_id" ON "Media" ("anilist_id")`);

    // Drop external IDs
    await queryRunner.query(`DROP TABLE "MediaExternalId"`);
    await queryRunner.query(`DROP TYPE external_source_type`);
  }
}
