import { MigrationInterface, QueryRunner } from "typeorm";

export class SegmentStatusToEnum1739580001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the enum type
    await queryRunner.query(`
      CREATE TYPE segment_status AS ENUM ('DELETED', 'ACTIVE', 'SUSPENDED', 'VERIFIED', 'INVALID', 'TOO_LONG')
    `);

    // Convert existing integer values to enum
    await queryRunner.query(`
      ALTER TABLE "Segment"
      ALTER COLUMN status TYPE segment_status
      USING (
        CASE status
          WHEN 0 THEN 'DELETED'
          WHEN 1 THEN 'ACTIVE'
          WHEN 2 THEN 'SUSPENDED'
          WHEN 3 THEN 'VERIFIED'
          WHEN 100 THEN 'INVALID'
          WHEN 101 THEN 'TOO_LONG'
        END
      )::segment_status
    `);

    // Set the default
    await queryRunner.query(`
      ALTER TABLE "Segment" ALTER COLUMN status SET DEFAULT 'ACTIVE'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove default
    await queryRunner.query(`
      ALTER TABLE "Segment" ALTER COLUMN status DROP DEFAULT
    `);

    // Convert back to integer
    await queryRunner.query(`
      ALTER TABLE "Segment"
      ALTER COLUMN status TYPE smallint
      USING (
        CASE status
          WHEN 'DELETED' THEN 0
          WHEN 'ACTIVE' THEN 1
          WHEN 'SUSPENDED' THEN 2
          WHEN 'VERIFIED' THEN 3
          WHEN 'INVALID' THEN 100
          WHEN 'TOO_LONG' THEN 101
        END
      )::smallint
    `);

    // Set old default
    await queryRunner.query(`
      ALTER TABLE "Segment" ALTER COLUMN status SET DEFAULT 1
    `);

    // Drop the enum type
    await queryRunner.query(`DROP TYPE segment_status`);
  }
}
