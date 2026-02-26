import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ActivityTypeShare1706151300000 implements MigrationInterface {
  name = 'ActivityTypeShare1706151300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "activity_type" ADD VALUE IF NOT EXISTS 'SHARE'`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing enum values
  }
}
