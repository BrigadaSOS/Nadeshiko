import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rewrites blank activity metadata to NULL, and stops it coming back.
 *
 * The optional columns on `UserActivity` are nullable and the API contract marks
 * them `minLength: 1`, but nothing enforced the gap between "absent" and "present
 * but empty". Clients that had no media name sent `''`, it was stored verbatim,
 * and `GET /v1/user/activity` then failed response validation for the entire page
 * -- a 500 for the reader whose timeline happened to contain one. The same rows
 * broke the account data export, which serializes activity through the same
 * mapper.
 *
 * The CHECK constraints are the backstop, not the fix: the write path normalizes
 * first, so a constraint violation here means a new writer appeared that skipped
 * it. Failing that insert loudly is correct -- activity tracking is fire-and-
 * forget and already swallows errors into a warning, so the cost of being wrong
 * is a logged warning rather than a corrupted read for everyone else.
 *
 * Whitespace-only values are left to the application's normalizer rather than
 * matched here with a trim: `''` is the shape that actually occurs, and a
 * migration that rewrites `"   "` is guessing at intent on rows it cannot see.
 */
export class NormalizeBlankActivityMetadata1786200000000 implements MigrationInterface {
  name = 'NormalizeBlankActivityMetadata1786200000000';

  private static readonly COLUMNS = [
    'segment_id',
    'media_public_id',
    'search_query',
    'anime_name',
    'japanese_text',
  ] as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const column of NormalizeBlankActivityMetadata1786200000000.COLUMNS) {
      await queryRunner.query(`UPDATE "UserActivity" SET "${column}" = NULL WHERE "${column}" = ''`);
      await queryRunner.query(
        `ALTER TABLE "UserActivity" ADD CONSTRAINT "CHK_UserActivity_${column}_not_blank" CHECK ("${column}" <> '')`,
      );
    }
  }

  /**
   * Drops the constraints only. The rows that were `''` are indistinguishable
   * from rows that were always NULL once rewritten, and restoring them would mean
   * reintroducing exactly the values that caused the outage.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of NormalizeBlankActivityMetadata1786200000000.COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "UserActivity" DROP CONSTRAINT IF EXISTS "CHK_UserActivity_${column}_not_blank"`,
      );
    }
  }
}
