import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddYoutubeEnums1746100000000 implements MigrationInterface {
  name = 'AddYoutubeEnums1746100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "category_type" ADD VALUE IF NOT EXISTS 'YOUTUBE'`);
    await queryRunner.query(`ALTER TYPE "external_source_type" ADD VALUE IF NOT EXISTS 'YOUTUBE'`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing values from an enum type
  }
}
