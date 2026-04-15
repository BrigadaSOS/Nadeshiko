import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SimplifySegmentStatus1743200000000 implements MigrationInterface {
  name = 'SimplifySegmentStatus1743200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add HIDDEN to the enum
    await queryRunner.query(`ALTER TYPE "segment_status" ADD VALUE IF NOT EXISTS 'HIDDEN'`);

    // Map SUSPENDED → HIDDEN, INVALID → HIDDEN, TOO_LONG → HIDDEN
    await queryRunner.query(`UPDATE "Segment" SET status = 'HIDDEN' WHERE status IN ('SUSPENDED', 'INVALID', 'TOO_LONG')`);

    // Note: PostgreSQL doesn't support removing enum values directly.
    // The old values (SUSPENDED, INVALID, TOO_LONG, VERIFIED) remain in the enum
    // but are no longer used by the application. This is safe — unused enum values
    // don't cause issues and removing them would require recreating the column.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Map HIDDEN back to SUSPENDED
    await queryRunner.query(`UPDATE "Segment" SET status = 'SUSPENDED' WHERE status = 'HIDDEN'`);
  }
}
