import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Segment gains `tokens`, the Shirabe analysis.
 *
 * A column of its own rather than overwriting `pos_analysis`, for two reasons.
 * `pos_analysis` means "the SudachiPy analysis": a bag keyed by analyzer
 * (`{sudachi: [...], unidic: [...], _tokenizer_*: ...}`), and putting a different
 * thing in a name that says otherwise is how a column ends up needing a comment
 * to explain what is in it. And keeping the two apart makes the backfill
 * reversible for free, without a snapshot: the old analysis is still sitting
 * there while the new one is checked over.
 *
 * `pos_analysis` stays NOT NULL here, so this cannot be the migration that
 * breaks ingest. It was dropped once the corpus was fully reparsed and nothing
 * read it any more, by 1746600000000-drop-segment-pos-analysis.
 *
 * Nullable on purpose: a segment with no tokens yet is a real state during a
 * 1.5M-row reparse, and `SegmentIndexer` already renders a row without them as
 * plain highlight HTML.
 */
export class SegmentShirabeTokens1746300000000 implements MigrationInterface {
  name = 'SegmentShirabeTokens1746300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Segment" ADD COLUMN IF NOT EXISTS "tokens" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Segment" DROP COLUMN IF EXISTS "tokens"`);
  }
}
