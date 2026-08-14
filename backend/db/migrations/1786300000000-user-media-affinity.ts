import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A monthly tally of which titles each reader studies, kept apart from the
 * activity log it is seeded from.
 *
 * The search media filter lists every title matching a query, alphabetically,
 * which buries the handful of shows a reader actually knows. The tally is what
 * sorts those back to the top.
 *
 * It could not be read off `UserActivity`. That table is emptied at 90 days by
 * `activityRetentionWorker`, so a reader returning from a break would look like
 * a stranger; and it is not written at all when `searchHistory` is off, which
 * would silently make familiarity a feature of a consent decision about a
 * different dataset. This table answers to its own preference
 * (`familiarMedia.enabled`), its own clear endpoint, and its own retention.
 *
 * Existing readers who had already turned `searchHistory` off are seeded to
 * disabled here. They said no to being recorded; inferring that they meant only
 * the other table would be reading a preference generously in our own favour.
 *
 * The backfill buckets in UTC to match `AccountQuotaUsage.getCurrentPeriodYyyymm`,
 * which the runtime upsert uses. `to_char` alone would resolve in the database
 * session's timezone, so events near a month boundary would land in a different
 * bucket than the live path puts them in -- two sources disagreeing about which
 * month a play happened in.
 */
export class UserMediaAffinity1786300000000 implements MigrationInterface {
  name = 'UserMediaAffinity1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "UserMediaAffinity" (
        "id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "media_public_id" character varying NOT NULL,
        "period_yyyymm" integer NOT NULL,
        "anki_count" integer NOT NULL DEFAULT 0,
        "play_count" integer NOT NULL DEFAULT 0,
        "share_count" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP DEFAULT now()
      )
    `);

    // Serves the upsert's ON CONFLICT target and, by prefix, the per-user read.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_UserMediaAffinity_user_media_period"
      ON "UserMediaAffinity" ("user_id", "media_public_id", "period_yyyymm")
    `);

    // Serves the retention sweep, which scans by period alone.
    await queryRunner.query(`
      CREATE INDEX "IDX_UserMediaAffinity_period"
      ON "UserMediaAffinity" ("period_yyyymm")
    `);

    await queryRunner.query(`
      UPDATE "User"
      SET preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{familiarMedia}', '{"enabled": false}'::jsonb)
      WHERE preferences->'searchHistory'->>'enabled' = 'false'
    `);

    // Whatever survived the 90-day purge, so the feature is not empty on day one.
    // SEARCH is excluded: searching for a title is not evidence of knowing it.
    await queryRunner.query(`
      INSERT INTO "UserMediaAffinity"
        ("user_id", "media_public_id", "period_yyyymm", "anki_count", "play_count", "share_count")
      SELECT
        activity.user_id,
        activity.media_public_id,
        to_char(activity.created_at AT TIME ZONE 'UTC', 'YYYYMM')::int,
        COUNT(*) FILTER (WHERE activity.activity_type = 'ANKI_EXPORT'),
        COUNT(*) FILTER (WHERE activity.activity_type = 'SEGMENT_PLAY'),
        COUNT(*) FILTER (WHERE activity.activity_type = 'SHARE')
      FROM "UserActivity" activity
      JOIN "User" u ON u.id = activity.user_id
      WHERE activity.media_public_id IS NOT NULL
        AND activity.activity_type IN ('ANKI_EXPORT', 'SEGMENT_PLAY', 'SHARE')
        AND COALESCE(u.preferences->'familiarMedia'->>'enabled', 'true') <> 'false'
      GROUP BY activity.user_id, activity.media_public_id,
               to_char(activity.created_at AT TIME ZONE 'UTC', 'YYYYMM')::int
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "UserMediaAffinity"`);
    // The seeded preference is left in place: it records a choice, and rerunning
    // `up` would only reach the same conclusion from the same evidence.
  }
}
