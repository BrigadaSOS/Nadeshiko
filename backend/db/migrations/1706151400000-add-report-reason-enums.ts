import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReportReasonEnums1706151400000 implements MigrationInterface {
  name = 'AddReportReasonEnums1706151400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "report_reason" ADD VALUE 'WRONG_JAPANESE_TEXT'`);
    await queryRunner.query(`ALTER TYPE "report_reason" ADD VALUE 'LOW_QUALITY_AUDIO'`);
    await queryRunner.query(`ALTER TYPE "report_reason" ADD VALUE 'WRONG_TITLE'`);
    await queryRunner.query(`ALTER TYPE "report_reason" ADD VALUE 'DUPLICATE_MEDIA'`);
    await queryRunner.query(`ALTER TYPE "report_reason" ADD VALUE 'WRONG_EPISODE_NUMBER'`);
    await queryRunner.query(`ALTER TYPE "report_reason" ADD VALUE 'IMAGE_ISSUE'`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing values from an enum type
  }
}
