import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Enums1706150400000 implements MigrationInterface {
  name = 'Enums1706150400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "user_role_enum" AS ENUM ('ADMIN', 'MOD', 'USER', 'PATREON')
    `);

    await queryRunner.query(`
      CREATE TYPE "api_permission_enum" AS ENUM (
        'ADD_MEDIA', 'READ_MEDIA', 'REMOVE_MEDIA', 'UPDATE_MEDIA',
        'READ_LISTS', 'CREATE_LISTS', 'UPDATE_LISTS', 'DELETE_LISTS'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "category_type" AS ENUM ('ANIME', 'JDRAMA')
    `);

    await queryRunner.query(`
      CREATE TYPE "character_role" AS ENUM ('MAIN', 'SUPPORTING', 'BACKGROUND')
    `);

    await queryRunner.query(`
      CREATE TYPE "segment_status" AS ENUM ('DELETED', 'ACTIVE', 'SUSPENDED', 'VERIFIED', 'INVALID', 'TOO_LONG')
    `);

    await queryRunner.query(`
      CREATE TYPE "segment_storage" AS ENUM ('LOCAL', 'R2')
    `);

    await queryRunner.query(`
      CREATE TYPE "content_rating" AS ENUM ('SAFE', 'SUGGESTIVE', 'QUESTIONABLE', 'EXPLICIT')
    `);

    await queryRunner.query(`
      CREATE TYPE "collection_visibility" AS ENUM ('PUBLIC', 'PRIVATE')
    `);

    await queryRunner.query(`
      CREATE TYPE "activity_type" AS ENUM ('SEARCH', 'ANKI_EXPORT', 'SEGMENT_PLAY', 'LIST_ADD_SEGMENT')
    `);

    await queryRunner.query(`
      CREATE TYPE "report_status" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'RESOLVED', 'CONCERN', 'IGNORED')
    `);

    await queryRunner.query(`
      CREATE TYPE "report_reason" AS ENUM (
        'WRONG_TRANSLATION', 'WRONG_TIMING', 'WRONG_AUDIO', 'NSFW_NOT_TAGGED', 'DUPLICATE_SEGMENT',
        'WRONG_METADATA', 'MISSING_EPISODES', 'WRONG_COVER_IMAGE',
        'INAPPROPRIATE_CONTENT', 'OTHER',
        'LOW_SEGMENT_MEDIA', 'EMPTY_EPISODES', 'MISSING_EPISODES_AUTO', 'BAD_SEGMENT_RATIO',
        'MEDIA_WITH_NO_EPISODES', 'MISSING_TRANSLATIONS', 'DB_ES_SYNC_ISSUES', 'HIGH_REPORT_DENSITY'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "report_source" AS ENUM ('USER', 'AUTO')
    `);

    await queryRunner.query(`
      CREATE TYPE "report_target_type" AS ENUM ('SEGMENT', 'EPISODE', 'MEDIA')
    `);

    await queryRunner.query(`
      CREATE TYPE "review_check_target_type" AS ENUM ('MEDIA', 'EPISODE')
    `);

    await queryRunner.query(`
      CREATE TYPE "external_source_type" AS ENUM ('ANILIST', 'IMDB', 'TVDB')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TYPE "external_source_type"`);
    await queryRunner.query(`DROP TYPE "review_check_target_type"`);
    await queryRunner.query(`DROP TYPE "report_target_type"`);
    await queryRunner.query(`DROP TYPE "report_source"`);
    await queryRunner.query(`DROP TYPE "report_reason"`);
    await queryRunner.query(`DROP TYPE "report_status"`);
    await queryRunner.query(`DROP TYPE "activity_type"`);
    await queryRunner.query(`DROP TYPE "collection_visibility"`);
    await queryRunner.query(`DROP TYPE "content_rating"`);
    await queryRunner.query(`DROP TYPE "segment_storage"`);
    await queryRunner.query(`DROP TYPE "segment_status"`);
    await queryRunner.query(`DROP TYPE "character_role"`);
    await queryRunner.query(`DROP TYPE "category_type"`);
    await queryRunner.query(`DROP TYPE "api_permission_enum"`);
    await queryRunner.query(`DROP TYPE "user_role_enum"`);
  }
}
