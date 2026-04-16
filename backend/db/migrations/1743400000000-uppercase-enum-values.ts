import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UppercaseEnumValues1743400000000 implements MigrationInterface {
  name = 'UppercaseEnumValues1743400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "Announcement"
      SET type = UPPER(type)
      WHERE type IN ('info', 'warning', 'maintenance')
    `);

    await queryRunner.query(`
      UPDATE "User"
      SET preferences = jsonb_set(
        preferences,
        '{mediaNameLanguage}',
        to_jsonb(UPPER(preferences->>'mediaNameLanguage'))
      )
      WHERE preferences->>'mediaNameLanguage' IN ('english', 'japanese', 'romaji')
    `);

    await queryRunner.query(`
      UPDATE "User"
      SET preferences = jsonb_set(
        preferences,
        '{contentRatingPreferences,questionable}',
        to_jsonb(UPPER(preferences->'contentRatingPreferences'->>'questionable'))
      )
      WHERE preferences->'contentRatingPreferences'->>'questionable' IN ('show', 'blur', 'hide')
    `);

    await queryRunner.query(`
      UPDATE "User"
      SET preferences = jsonb_set(
        preferences,
        '{contentRatingPreferences,explicit}',
        to_jsonb(UPPER(preferences->'contentRatingPreferences'->>'explicit'))
      )
      WHERE preferences->'contentRatingPreferences'->>'explicit' IN ('show', 'blur', 'hide')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "Announcement"
      SET type = LOWER(type)
      WHERE type IN ('INFO', 'WARNING', 'MAINTENANCE')
    `);

    await queryRunner.query(`
      UPDATE "User"
      SET preferences = jsonb_set(
        preferences,
        '{mediaNameLanguage}',
        to_jsonb(LOWER(preferences->>'mediaNameLanguage'))
      )
      WHERE preferences->>'mediaNameLanguage' IN ('ENGLISH', 'JAPANESE', 'ROMAJI')
    `);

    await queryRunner.query(`
      UPDATE "User"
      SET preferences = jsonb_set(
        preferences,
        '{contentRatingPreferences,questionable}',
        to_jsonb(LOWER(preferences->'contentRatingPreferences'->>'questionable'))
      )
      WHERE preferences->'contentRatingPreferences'->>'questionable' IN ('SHOW', 'BLUR', 'HIDE')
    `);

    await queryRunner.query(`
      UPDATE "User"
      SET preferences = jsonb_set(
        preferences,
        '{contentRatingPreferences,explicit}',
        to_jsonb(LOWER(preferences->'contentRatingPreferences'->>'explicit'))
      )
      WHERE preferences->'contentRatingPreferences'->>'explicit' IN ('SHOW', 'BLUR', 'HIDE')
    `);
  }
}
