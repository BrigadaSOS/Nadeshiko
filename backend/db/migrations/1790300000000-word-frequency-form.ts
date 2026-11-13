import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `form`: the kana form of a frequency-list entry (`私,わたし,28` keeps `わたし`). The difficulty sort looks up a
 * kana-written token by its reading when its own spelling is not on the list, so the seed keeps this column again
 * (the old `reading` column was dropped in 1746700000000 when nothing read it).
 *
 * Nullable and without a default, so `ADD COLUMN` is metadata-only. The values arrive with the next
 * `scripts/seed-word-frequency.ts` run, which must be followed by a full Elasticsearch reindex.
 */
export class WordFrequencyForm1790300000000 implements MigrationInterface {
  name = 'WordFrequencyForm1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "WordFrequency" ADD COLUMN IF NOT EXISTS "form" character varying(50)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "WordFrequency" DROP COLUMN IF EXISTS "form"`);
  }
}
