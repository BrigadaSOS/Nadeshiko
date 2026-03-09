import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ActivitySegmentIdToVarchar1741700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserActivity" ALTER COLUMN "segment_id" TYPE varchar USING "segment_id"::varchar`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserActivity" ALTER COLUMN "segment_id" TYPE int USING "segment_id"::int`,
    );
  }
}
