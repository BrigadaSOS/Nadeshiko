import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTmdbExternalSource1741500000000 implements MigrationInterface {
  name = 'AddTmdbExternalSource1741500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "external_source_type" ADD VALUE IF NOT EXISTS 'TMDB'`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing values from an enum type
  }
}
