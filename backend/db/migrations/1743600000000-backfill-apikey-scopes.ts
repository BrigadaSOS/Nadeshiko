import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillApikeyScopes1743600000000 implements MigrationInterface {
  name = 'BackfillApikeyScopes1743600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH normalized AS (
        SELECT
          id,
          COALESCE(NULLIF("permissions", ''), '{"api":[]}'::text)::jsonb AS permissions_json
        FROM "apikey"
      ),
      updated AS (
        SELECT
          id,
          jsonb_set(
            permissions_json,
            '{api}',
            to_jsonb(ARRAY(
              SELECT DISTINCT perm
              FROM unnest(
                ARRAY(
                  SELECT CASE value
                    WHEN 'READ_LISTS' THEN 'READ_COLLECTIONS'
                    WHEN 'CREATE_LISTS' THEN 'CREATE_COLLECTIONS'
                    WHEN 'UPDATE_LISTS' THEN 'UPDATE_COLLECTIONS'
                    WHEN 'DELETE_LISTS' THEN 'DELETE_COLLECTIONS'
                    ELSE value
                  END
                  FROM jsonb_array_elements_text(COALESCE(permissions_json->'api', '[]'::jsonb))
                )
                || ARRAY[
                  'READ_PROFILE',
                  'WRITE_PROFILE',
                  'READ_ACTIVITY',
                  'WRITE_ACTIVITY',
                  'READ_COLLECTIONS',
                  'CREATE_COLLECTIONS',
                  'UPDATE_COLLECTIONS',
                  'DELETE_COLLECTIONS'
                ]
              ) AS perm
              ORDER BY perm
            )),
            true
          ) AS new_permissions_json
        FROM normalized
      )
      UPDATE "apikey" AS a
      SET "permissions" = updated.new_permissions_json::text
      FROM updated
      WHERE a.id = updated.id
        AND a."permissions" IS DISTINCT FROM updated.new_permissions_json::text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH normalized AS (
        SELECT
          id,
          COALESCE(NULLIF("permissions", ''), '{"api":[]}'::text)::jsonb AS permissions_json
        FROM "apikey"
      ),
      updated AS (
        SELECT
          id,
          jsonb_set(
            permissions_json,
            '{api}',
            to_jsonb(ARRAY(
              SELECT DISTINCT perm
              FROM unnest(
                ARRAY(
                  SELECT CASE value
                    WHEN 'READ_COLLECTIONS' THEN 'READ_LISTS'
                    WHEN 'CREATE_COLLECTIONS' THEN 'CREATE_LISTS'
                    WHEN 'UPDATE_COLLECTIONS' THEN 'UPDATE_LISTS'
                    WHEN 'DELETE_COLLECTIONS' THEN 'DELETE_LISTS'
                    ELSE value
                  END
                  FROM jsonb_array_elements_text(COALESCE(permissions_json->'api', '[]'::jsonb))
                  WHERE value NOT IN ('READ_PROFILE', 'WRITE_PROFILE', 'READ_ACTIVITY', 'WRITE_ACTIVITY')
                )
              ) AS perm
              ORDER BY perm
            )),
            true
          ) AS new_permissions_json
        FROM normalized
      )
      UPDATE "apikey" AS a
      SET "permissions" = updated.new_permissions_json::text
      FROM updated
      WHERE a.id = updated.id
        AND a."permissions" IS DISTINCT FROM updated.new_permissions_json::text
    `);
  }
}
