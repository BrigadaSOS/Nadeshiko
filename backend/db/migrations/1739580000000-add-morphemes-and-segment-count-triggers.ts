import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMorphemesAndSegmentCountTriggers1739580000000 implements MigrationInterface {
  name = 'AddMorphemesAndSegmentCountTriggers1739580000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add morphemes JSONB column
    await queryRunner.query(`ALTER TABLE "Segment" ADD COLUMN "morphemes" jsonb`);

    // Create trigger function that updates segment counts on Episode and Media
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_segment_counts() RETURNS trigger AS $$
      DECLARE
        v_media_id int;
        v_episode int;
      BEGIN
        -- Determine which media_id and episode were affected
        IF TG_OP = 'DELETE' THEN
          v_media_id := OLD.media_id;
          v_episode := OLD.episode;
        ELSE
          v_media_id := NEW.media_id;
          v_episode := NEW.episode;
        END IF;

        -- Update Episode count
        UPDATE "Episode"
        SET num_segments = (
          SELECT COUNT(*) FROM "Segment"
          WHERE media_id = v_media_id AND episode = v_episode AND status != 0
        )
        WHERE media_id = v_media_id AND episode_number = v_episode;

        -- Update Media count
        UPDATE "Media"
        SET num_segments = (
          SELECT COUNT(*) FROM "Segment"
          WHERE media_id = v_media_id AND status != 0
        )
        WHERE id = v_media_id;

        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Fire on INSERT, DELETE, or when status changes (soft delete / restore)
    await queryRunner.query(`
      CREATE TRIGGER trg_segment_count_insert
        AFTER INSERT ON "Segment"
        FOR EACH ROW
        EXECUTE FUNCTION update_segment_counts();
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_segment_count_delete
        AFTER DELETE ON "Segment"
        FOR EACH ROW
        EXECUTE FUNCTION update_segment_counts();
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_segment_count_update
        AFTER UPDATE OF status ON "Segment"
        FOR EACH ROW
        WHEN (OLD.status IS DISTINCT FROM NEW.status)
        EXECUTE FUNCTION update_segment_counts();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_segment_count_insert ON "Segment"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_segment_count_delete ON "Segment"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_segment_count_update ON "Segment"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS update_segment_counts()`);
    await queryRunner.query(`ALTER TABLE "Segment" DROP COLUMN "morphemes"`);
  }
}
