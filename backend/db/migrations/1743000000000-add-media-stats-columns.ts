import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaStatsColumns1743000000000 implements MigrationInterface {
  name = 'AddMediaStatsColumns1743000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "Media"
        ADD COLUMN episode_count int NOT NULL DEFAULT 0,
        ADD COLUMN dialogue_duration_ms bigint NOT NULL DEFAULT 0,
        ADD COLUMN en_human_count int NOT NULL DEFAULT 0,
        ADD COLUMN en_machine_count int NOT NULL DEFAULT 0,
        ADD COLUMN es_human_count int NOT NULL DEFAULT 0,
        ADD COLUMN es_machine_count int NOT NULL DEFAULT 0
    `);

    // Backfill from existing data
    await queryRunner.query(`
      UPDATE "Media" m SET
        episode_count = COALESCE(ep.cnt, 0),
        dialogue_duration_ms = COALESCE(seg.dur, 0),
        en_human_count = COALESCE(seg.en_h, 0),
        en_machine_count = COALESCE(seg.en_m, 0),
        es_human_count = COALESCE(seg.es_h, 0),
        es_machine_count = COALESCE(seg.es_m, 0)
      FROM "Media" m2
      LEFT JOIN (
        SELECT media_id, COUNT(*)::int AS cnt
        FROM "Episode"
        GROUP BY media_id
      ) ep ON ep.media_id = m2.id
      LEFT JOIN (
        SELECT media_id,
          COALESCE(SUM(end_time_ms - start_time_ms) FILTER (WHERE end_time_ms > start_time_ms), 0)::bigint AS dur,
          COUNT(*) FILTER (WHERE content_english != '' AND content_english_mt = false)::int AS en_h,
          COUNT(*) FILTER (WHERE content_english_mt = true)::int AS en_m,
          COUNT(*) FILTER (WHERE content_spanish != '' AND content_spanish_mt = false)::int AS es_h,
          COUNT(*) FILTER (WHERE content_spanish_mt = true)::int AS es_m
        FROM "Segment" WHERE status != 'DELETED'
        GROUP BY media_id
      ) seg ON seg.media_id = m2.id
      WHERE m.id = m2.id
    `);

    // Replace the segment counts trigger to also maintain the new columns
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_segment_counts() RETURNS trigger AS $$
      DECLARE
        v_media_id int;
        v_episode int;
        v_old_active boolean;
        v_new_active boolean;
        v_dur_delta bigint := 0;
        v_en_h_delta int := 0;
        v_en_m_delta int := 0;
        v_es_h_delta int := 0;
        v_es_m_delta int := 0;
      BEGIN
        IF TG_OP = 'DELETE' THEN
          v_media_id := OLD.media_id;
          v_episode := OLD.episode;
        ELSE
          v_media_id := NEW.media_id;
          v_episode := NEW.episode;
        END IF;

        -- Update episode segment count (unchanged logic)
        UPDATE "Episode"
        SET num_segments = (
          SELECT COUNT(*) FROM "Segment"
          WHERE media_id = v_media_id AND episode = v_episode AND status != 'DELETED'
        )
        WHERE media_id = v_media_id AND episode_number = v_episode;

        -- Update media segment count (unchanged logic)
        UPDATE "Media"
        SET num_segments = (
          SELECT COUNT(*) FROM "Segment"
          WHERE media_id = v_media_id AND status != 'DELETED'
        )
        WHERE id = v_media_id;

        -- Compute deltas for the new stats columns
        v_old_active := (TG_OP != 'INSERT' AND OLD.status != 'DELETED');
        v_new_active := (TG_OP != 'DELETE' AND NEW.status != 'DELETED');

        -- Subtract old values if the row was previously active
        IF v_old_active THEN
          v_dur_delta := v_dur_delta - GREATEST(OLD.end_time_ms - OLD.start_time_ms, 0);
          IF OLD.content_english != '' AND NOT OLD.content_english_mt THEN v_en_h_delta := v_en_h_delta - 1; END IF;
          IF OLD.content_english_mt THEN v_en_m_delta := v_en_m_delta - 1; END IF;
          IF OLD.content_spanish != '' AND NOT OLD.content_spanish_mt THEN v_es_h_delta := v_es_h_delta - 1; END IF;
          IF OLD.content_spanish_mt THEN v_es_m_delta := v_es_m_delta - 1; END IF;
        END IF;

        -- Add new values if the row is now active
        IF v_new_active THEN
          v_dur_delta := v_dur_delta + GREATEST(NEW.end_time_ms - NEW.start_time_ms, 0);
          IF NEW.content_english != '' AND NOT NEW.content_english_mt THEN v_en_h_delta := v_en_h_delta + 1; END IF;
          IF NEW.content_english_mt THEN v_en_m_delta := v_en_m_delta + 1; END IF;
          IF NEW.content_spanish != '' AND NOT NEW.content_spanish_mt THEN v_es_h_delta := v_es_h_delta + 1; END IF;
          IF NEW.content_spanish_mt THEN v_es_m_delta := v_es_m_delta + 1; END IF;
        END IF;

        -- Apply deltas
        IF v_dur_delta != 0 OR v_en_h_delta != 0 OR v_en_m_delta != 0 OR v_es_h_delta != 0 OR v_es_m_delta != 0 THEN
          UPDATE "Media" SET
            dialogue_duration_ms = dialogue_duration_ms + v_dur_delta,
            en_human_count = en_human_count + v_en_h_delta,
            en_machine_count = en_machine_count + v_en_m_delta,
            es_human_count = es_human_count + v_es_h_delta,
            es_machine_count = es_machine_count + v_es_m_delta
          WHERE id = v_media_id;
        END IF;

        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);

    // Also fire on translation column updates (not just status)
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_segment_count_update ON "Segment"`);
    await queryRunner.query(`
      CREATE TRIGGER trg_segment_count_update
        AFTER UPDATE OF status, content_english, content_english_mt, content_spanish, content_spanish_mt, start_time_ms, end_time_ms
        ON "Segment"
        FOR EACH ROW
        WHEN (
          OLD.status IS DISTINCT FROM NEW.status
          OR OLD.content_english IS DISTINCT FROM NEW.content_english
          OR OLD.content_english_mt IS DISTINCT FROM NEW.content_english_mt
          OR OLD.content_spanish IS DISTINCT FROM NEW.content_spanish
          OR OLD.content_spanish_mt IS DISTINCT FROM NEW.content_spanish_mt
          OR OLD.start_time_ms IS DISTINCT FROM NEW.start_time_ms
          OR OLD.end_time_ms IS DISTINCT FROM NEW.end_time_ms
        )
        EXECUTE FUNCTION update_segment_counts()
    `);

    // Episode count trigger
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_episode_count() RETURNS trigger AS $$
      DECLARE
        v_media_id int;
      BEGIN
        IF TG_OP = 'DELETE' THEN
          v_media_id := OLD.media_id;
        ELSE
          v_media_id := NEW.media_id;
        END IF;

        UPDATE "Media"
        SET episode_count = (
          SELECT COUNT(*) FROM "Episode" WHERE media_id = v_media_id
        )
        WHERE id = v_media_id;

        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_episode_count_insert
        AFTER INSERT ON "Episode"
        FOR EACH ROW
        EXECUTE FUNCTION update_episode_count()
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_episode_count_delete
        AFTER DELETE ON "Episode"
        FOR EACH ROW
        EXECUTE FUNCTION update_episode_count()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_episode_count_delete ON "Episode"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_episode_count_insert ON "Episode"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS update_episode_count()`);

    // Restore original update trigger (status only)
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_segment_count_update ON "Segment"`);
    await queryRunner.query(`
      CREATE TRIGGER trg_segment_count_update
        AFTER UPDATE OF status ON "Segment"
        FOR EACH ROW
        WHEN (OLD.status IS DISTINCT FROM NEW.status)
        EXECUTE FUNCTION update_segment_counts()
    `);

    // Restore original trigger function
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_segment_counts() RETURNS trigger AS $$
      DECLARE
        v_media_id int;
        v_episode int;
      BEGIN
        IF TG_OP = 'DELETE' THEN
          v_media_id := OLD.media_id;
          v_episode := OLD.episode;
        ELSE
          v_media_id := NEW.media_id;
          v_episode := NEW.episode;
        END IF;

        UPDATE "Episode"
        SET num_segments = (
          SELECT COUNT(*) FROM "Segment"
          WHERE media_id = v_media_id AND episode = v_episode AND status != 'DELETED'
        )
        WHERE media_id = v_media_id AND episode_number = v_episode;

        UPDATE "Media"
        SET num_segments = (
          SELECT COUNT(*) FROM "Segment"
          WHERE media_id = v_media_id AND status != 'DELETED'
        )
        WHERE id = v_media_id;

        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      ALTER TABLE "Media"
        DROP COLUMN episode_count,
        DROP COLUMN dialogue_duration_ms,
        DROP COLUMN en_human_count,
        DROP COLUMN en_machine_count,
        DROP COLUMN es_human_count,
        DROP COLUMN es_machine_count
    `);
  }
}
