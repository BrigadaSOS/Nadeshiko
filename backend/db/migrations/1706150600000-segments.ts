import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Segments1706150600000 implements MigrationInterface {
  name = 'Segments1706150600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "Segment" (
        "id" SERIAL PRIMARY KEY,
        "uuid" varchar NOT NULL UNIQUE,
        "position" integer NOT NULL,
        "status" segment_status NOT NULL DEFAULT 'ACTIVE',
        "start_time_ms" integer NOT NULL,
        "end_time_ms" integer NOT NULL,
        "content" varchar(500) NOT NULL,
        "content_spanish" varchar(500) NOT NULL,
        "content_spanish_mt" boolean NOT NULL DEFAULT false,
        "content_english" varchar(500) NOT NULL,
        "content_english_mt" boolean NOT NULL DEFAULT false,
        "content_rating" content_rating NOT NULL DEFAULT 'SAFE',
        "rating_analysis" jsonb,
        "pos_analysis" jsonb,
        "storage" segment_storage NOT NULL DEFAULT 'R2',
        "hashed_id" varchar NOT NULL,
        "storage_base_path" varchar NOT NULL,
        "media_id" integer NOT NULL,
        "episode" smallint NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ,
        CONSTRAINT "Segment_media_fkey" FOREIGN KEY ("media_id") REFERENCES "Media"("id"),
        CONSTRAINT "Segment_episode_fkey" FOREIGN KEY ("media_id", "episode")
          REFERENCES "Episode"("media_id", "episode_number") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_Segment_media_episode" ON "Segment" ("media_id", "episode")
    `);

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
      CREATE TRIGGER trg_segment_count_insert
        AFTER INSERT ON "Segment"
        FOR EACH ROW
        EXECUTE FUNCTION update_segment_counts()
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_segment_count_delete
        AFTER DELETE ON "Segment"
        FOR EACH ROW
        EXECUTE FUNCTION update_segment_counts()
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_segment_count_update
        AFTER UPDATE OF status ON "Segment"
        FOR EACH ROW
        WHEN (OLD.status IS DISTINCT FROM NEW.status)
        EXECUTE FUNCTION update_segment_counts()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_segment_count_update ON "Segment"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_segment_count_delete ON "Segment"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_segment_count_insert ON "Segment"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS update_segment_counts()`);
    await queryRunner.query(`DROP INDEX "IDX_Segment_media_episode"`);
    await queryRunner.query(`DROP TABLE "Segment"`);
  }
}
