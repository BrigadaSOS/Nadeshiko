import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema changes for YouTube channel support:
 * - Episode gains `external_video_id` (the YouTube video ID), keying segment
 *   storage and the watch/embed URL. A partial unique index dedupes episodes by
 *   video ID so re-ingesting a channel from any machine is idempotent.
 * - Segment gains `external_video_id`, denormalized from its episode (like
 *   `episode`), so storage URLs and the segment UUID can be keyed by video ID.
 *
 * The anime/drama descriptive columns (airing_format/status, season_name/year)
 * stay NOT NULL: YouTube media supply them too (airing_format `YOUTUBE`,
 * season_name `NONE`), so no schema change is needed there.
 */
export class YoutubeMediaColumns1746200000000 implements MigrationInterface {
  name = 'YoutubeMediaColumns1746200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "external_video_id" varchar`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_Episode_media_external_video_id" ON "Episode" ("media_id", "external_video_id") WHERE "external_video_id" IS NOT NULL`,
    );

    await queryRunner.query(`ALTER TABLE "Segment" ADD COLUMN IF NOT EXISTS "external_video_id" varchar`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Segment" DROP COLUMN IF EXISTS "external_video_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_Episode_media_external_video_id"`);
    await queryRunner.query(`ALTER TABLE "Episode" DROP COLUMN IF EXISTS "external_video_id"`);
  }
}
