import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStorageBasePath1740000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Convert Media.storage from varchar to segment_storage enum (reusing existing type from Segment)
    await queryRunner.query(`ALTER TABLE "Media" ALTER COLUMN storage DROP DEFAULT`);
    await queryRunner.query(`
      ALTER TABLE "Media"
      ALTER COLUMN storage TYPE segment_storage
      USING (UPPER(storage))::segment_storage
    `);
    await queryRunner.query(`ALTER TABLE "Media" ALTER COLUMN storage SET DEFAULT 'R2'`);

    // Add storage_base_path column to Media table
    await queryRunner.query(`
      ALTER TABLE "Media"
      ADD COLUMN "storage_base_path" varchar NULL
    `);

    // Backfill existing media rows
    await queryRunner.query(`
      UPDATE "Media"
      SET storage_base_path = 'media/' || id
    `);

    // Add storage_base_path column to Segment table
    await queryRunner.query(`
      ALTER TABLE "Segment"
      ADD COLUMN "storage_base_path" varchar NULL
    `);

    // Backfill existing segment rows from their parent media
    await queryRunner.query(`
      UPDATE "Segment"
      SET storage_base_path = (
        SELECT storage_base_path FROM "Media" WHERE "Media".id = "Segment".media_id
      )
    `);

    // Make columns NOT NULL after backfill
    await queryRunner.query(`ALTER TABLE "Media" ALTER COLUMN "storage_base_path" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "Segment" ALTER COLUMN "storage_base_path" SET NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Segment" DROP COLUMN "storage_base_path"`);
    await queryRunner.query(`ALTER TABLE "Media" DROP COLUMN "storage_base_path"`);

    // Revert Media.storage back to varchar
    await queryRunner.query(`ALTER TABLE "Media" ALTER COLUMN storage DROP DEFAULT`);
    await queryRunner.query(`
      ALTER TABLE "Media"
      ALTER COLUMN storage TYPE varchar
      USING storage::text
    `);
    await queryRunner.query(`ALTER TABLE "Media" ALTER COLUMN storage SET DEFAULT 'r2'`);
  }
}
