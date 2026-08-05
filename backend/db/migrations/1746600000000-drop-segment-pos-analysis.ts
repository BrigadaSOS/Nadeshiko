import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops `pos_analysis`, the SudachiPy analysis.
 *
 * Shirabe parses the corpus now and its answer lands in `tokens`. The two ran
 * side by side while the reparse was checked over; nothing reads `pos_analysis`
 * any more, so it goes rather than sitting there as a column whose name promises
 * an answer no code asks for.
 *
 * `down` cannot bring the analysis back: it was derived by a Python pipeline
 * (SudachiPy + UniDic) that this repo no longer runs, and the values are not
 * recoverable from anything left in the database. It restores the column shape
 * so a rollback leaves a schema TypeORM recognises, filled with `{}`. Going back
 * for real means re-running that pipeline, and the point of this change is that
 * we do not intend to.
 *
 * The original CHECK (`<> '{}'`) is deliberately not restored: it would reject
 * every row `down` just wrote.
 */
export class DropSegmentPosAnalysis1746600000000 implements MigrationInterface {
  name = 'DropSegmentPosAnalysis1746600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Segment" DROP COLUMN IF EXISTS "pos_analysis"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Segment" ADD COLUMN IF NOT EXISTS "pos_analysis" jsonb NOT NULL DEFAULT '{}'::jsonb`,
    );
  }
}
