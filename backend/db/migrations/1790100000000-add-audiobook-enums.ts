import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Audiobook support: the AUDIOBOOK media category, and ASIN (Audible) as an external ID source,
 * which keys an audiobook's identity and segment UUIDs the way AniList does for anime.
 */
export class AddAudiobookEnums1790100000000 implements MigrationInterface {
  name = 'AddAudiobookEnums1790100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "category_type" ADD VALUE IF NOT EXISTS 'AUDIOBOOK'`);
    await queryRunner.query(`ALTER TYPE "external_source_type" ADD VALUE IF NOT EXISTS 'ASIN'`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing values from an enum type
  }
}
