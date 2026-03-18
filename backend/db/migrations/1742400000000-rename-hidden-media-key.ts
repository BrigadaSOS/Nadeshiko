import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameHiddenMediaKey1742400000000 implements MigrationInterface {
  name = 'RenameHiddenMediaKey1742400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "User"
      SET preferences = jsonb_set(
        preferences #- '{hiddenMedia}',
        '{hiddenMedia}',
        (
          SELECT COALESCE(jsonb_agg(
            (item - 'mediaId') || jsonb_build_object('mediaPublicId', item->>'mediaId')
          ), '[]'::jsonb)
          FROM jsonb_array_elements(preferences->'hiddenMedia') AS item
        )
      )
      WHERE preferences ? 'hiddenMedia'
        AND jsonb_array_length(preferences->'hiddenMedia') > 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "User"
      SET preferences = jsonb_set(
        preferences #- '{hiddenMedia}',
        '{hiddenMedia}',
        (
          SELECT COALESCE(jsonb_agg(
            (item - 'mediaPublicId') || jsonb_build_object('mediaId', item->>'mediaPublicId')
          ), '[]'::jsonb)
          FROM jsonb_array_elements(preferences->'hiddenMedia') AS item
        )
      )
      WHERE preferences ? 'hiddenMedia'
        AND jsonb_array_length(preferences->'hiddenMedia') > 0
    `);
  }
}
