import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One report per user, per target, per reason.
 *
 * `createUserReport` enforced this with a SELECT followed by an INSERT, which two
 * concurrent submissions both pass — a double-clicked report button is enough.
 * The rule belongs in the database. The controller keeps the SELECT as the fast
 * path and now also handles the 23505 it can lose to, so the endpoint stays
 * idempotent either way.
 *
 * Partial on `source = 'USER'`: AUTO reports are written one-per-run by the media
 * audit runner, carry no `user_id`, and are meant to repeat across runs.
 *
 * NULLS NOT DISTINCT because most of the target key is nullable — a MEDIA report
 * has neither an episode number nor a segment id, and under the default
 * NULLS DISTINCT the index would not constrain those rows at all. Postgres 15+;
 * every environment here is on 16 (CI) or 17 (dev and prod).
 */
export class ReportUserTargetUnique1746400000000 implements MigrationInterface {
  name = 'ReportUserTargetUnique1746400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Duplicates already in the table would fail the index build. Keep the
    // earliest of each group: that is the row the old SELECT would have returned,
    // so this drops only reports that were never reachable through the API.
    await queryRunner.query(`
      DELETE FROM "Report" duplicate
      USING "Report" kept
      WHERE duplicate."source" = 'USER'
        AND kept."source" = 'USER'
        AND duplicate."user_id" IS NOT NULL
        AND kept."user_id" = duplicate."user_id"
        AND kept."target_type" = duplicate."target_type"
        AND kept."target_media_id" = duplicate."target_media_id"
        AND kept."target_episode_number" IS NOT DISTINCT FROM duplicate."target_episode_number"
        AND kept."target_segment_id" IS NOT DISTINCT FROM duplicate."target_segment_id"
        AND kept."reason" = duplicate."reason"
        AND kept."id" < duplicate."id"
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_Report_user_target_reason"
      ON "Report" (
        "user_id",
        "target_type",
        "target_media_id",
        "target_episode_number",
        "target_segment_id",
        "reason"
      )
      NULLS NOT DISTINCT
      WHERE "source" = 'USER' AND "user_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_Report_user_target_reason"`);
  }
}
