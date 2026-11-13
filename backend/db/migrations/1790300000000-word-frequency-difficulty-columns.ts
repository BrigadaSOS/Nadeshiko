import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Columns the difficulty sort reads from `WordFrequency`:
 * - `form`: the kana form of a frequency-list entry (`私,わたし,28` keeps `わたし`). A kana-written token is looked up
 *   by its reading when its own spelling is not on the list. The old `reading` column was dropped in 1746700000000
 *   when nothing read it.
 * - `is_name`: the entry is only a proper name (in JMnedict, not in JMdict). The list ranks names like 田中 or ナルト
 *   by how often they occur, so without this they would read as hard vocabulary.
 *
 * Both are metadata-only additions (nullable, or a constant default). Values arrive with the next
 * `scripts/seed-word-frequency.ts` run, which must be followed by a full Elasticsearch reindex.
 */
export class WordFrequencyDifficultyColumns1790300000000 implements MigrationInterface {
  name = 'WordFrequencyDifficultyColumns1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "WordFrequency" ADD COLUMN IF NOT EXISTS "form" character varying(50)`);
    await queryRunner.query(
      `ALTER TABLE "WordFrequency" ADD COLUMN IF NOT EXISTS "is_name" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "WordFrequency" DROP COLUMN IF EXISTS "is_name"`);
    await queryRunner.query(`ALTER TABLE "WordFrequency" DROP COLUMN IF EXISTS "form"`);
  }
}
