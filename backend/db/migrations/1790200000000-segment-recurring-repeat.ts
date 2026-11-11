import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `recurring_repeat`: this segment is a later copy of a line that recurs across episodes of its title as part of an
 * opening, ending, recap or preview -- see `app/services/search/recurringLines.ts` for the rule. It is computed at
 * write time per title and copied into the search index, so search filters on it in Elasticsearch instead of looking
 * repeats up in Postgres on every page.
 *
 * `ADD COLUMN ... DEFAULT false` is a metadata-only change on PostgreSQL 11+, so it does not rewrite the table. The
 * values are filled by the recurring-lines sweep, which the backend runs at boot.
 */
export class SegmentRecurringRepeat1790200000000 implements MigrationInterface {
  name = 'SegmentRecurringRepeat1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Segment" ADD COLUMN IF NOT EXISTS "recurring_repeat" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Segment" DROP COLUMN IF EXISTS "recurring_repeat"`);
  }
}
