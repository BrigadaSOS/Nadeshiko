import { MigrationInterface, QueryRunner } from "typeorm";

export class SegmentStorageToEnum1739580002000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE segment_storage AS ENUM ('LOCAL', 'R2')
    `);

    await queryRunner.query(`
      ALTER TABLE "Segment"
      ALTER COLUMN storage TYPE segment_storage
      USING (UPPER(storage))::segment_storage
    `);

    await queryRunner.query(`
      ALTER TABLE "Segment" ALTER COLUMN storage SET DEFAULT 'R2'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "Segment" ALTER COLUMN storage DROP DEFAULT
    `);

    await queryRunner.query(`
      ALTER TABLE "Segment"
      ALTER COLUMN storage TYPE varchar
      USING LOWER(storage::text)
    `);

    await queryRunner.query(`
      ALTER TABLE "Segment" ALTER COLUMN storage SET DEFAULT 'r2'
    `);

    await queryRunner.query(`DROP TYPE segment_storage`);
  }
}
