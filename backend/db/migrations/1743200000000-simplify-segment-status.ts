import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SimplifySegmentStatus1743200000000 implements MigrationInterface {
  name = 'SimplifySegmentStatus1743200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add HIDDEN to the enum. Must be committed before it can be used,
    // so we commit the current transaction, add the value, then start a new one.
    await queryRunner.commitTransaction();
    await queryRunner.query(`ALTER TYPE "segment_status" ADD VALUE IF NOT EXISTS 'HIDDEN'`);
    await queryRunner.startTransaction();

    // Map SUSPENDED, INVALID, TOO_LONG to HIDDEN
    await queryRunner.query(
      `UPDATE "Segment" SET status = 'HIDDEN' WHERE status IN ('SUSPENDED', 'INVALID', 'TOO_LONG')`,
    );

    // Note: PostgreSQL doesn't support removing enum values directly.
    // The old values (SUSPENDED, INVALID, TOO_LONG, VERIFIED) remain in the enum
    // but are no longer used by the application. This is safe -- unused enum values
    // don't cause issues and removing them would require recreating the column.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Map HIDDEN back to SUSPENDED
    await queryRunner.query(`UPDATE "Segment" SET status = 'SUSPENDED' WHERE status = 'HIDDEN'`);
  }
}
