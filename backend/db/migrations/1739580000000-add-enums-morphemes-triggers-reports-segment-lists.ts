import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEnumsMorphemesTriggersReportsSegmentLists1739580000000 implements MigrationInterface {
  name = 'AddEnumsMorphemesTriggersReportsSegmentLists1739580000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ===== NEW ENUM TYPES =====
    await queryRunner.query(`
      CREATE TYPE segment_status AS ENUM ('DELETED', 'ACTIVE', 'SUSPENDED', 'VERIFIED', 'INVALID', 'TOO_LONG')
    `);

    await queryRunner.query(`
      CREATE TYPE segment_storage AS ENUM ('LOCAL', 'R2')
    `);

    await queryRunner.query(`CREATE TYPE report_type AS ENUM ('SEGMENT', 'MEDIA')`);
    await queryRunner.query(`CREATE TYPE report_status AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'RESOLVED')`);
    await queryRunner.query(`
      CREATE TYPE report_reason AS ENUM (
        'WRONG_TRANSLATION', 'WRONG_TIMING', 'WRONG_AUDIO', 'NSFW_NOT_TAGGED', 'DUPLICATE_SEGMENT',
        'WRONG_METADATA', 'MISSING_EPISODES', 'WRONG_COVER_IMAGE',
        'INAPPROPRIATE_CONTENT', 'OTHER'
      )
    `);

    // ===== SEGMENT: add morphemes column =====
    await queryRunner.query(`ALTER TABLE "Segment" ADD COLUMN "morphemes" jsonb`);

    // ===== SEGMENT: convert status smallint -> segment_status enum =====
    await queryRunner.query(`ALTER TABLE "Segment" ALTER COLUMN status DROP DEFAULT`);
    await queryRunner.query(`
      ALTER TABLE "Segment"
      ALTER COLUMN status TYPE segment_status
      USING (
        CASE status
          WHEN 0 THEN 'DELETED'
          WHEN 1 THEN 'ACTIVE'
          WHEN 2 THEN 'SUSPENDED'
          WHEN 3 THEN 'VERIFIED'
          WHEN 100 THEN 'INVALID'
          WHEN 101 THEN 'TOO_LONG'
        END
      )::segment_status
    `);
    await queryRunner.query(`ALTER TABLE "Segment" ALTER COLUMN status SET DEFAULT 'ACTIVE'`);

    // ===== SEGMENT: convert storage varchar -> segment_storage enum =====
    await queryRunner.query(`ALTER TABLE "Segment" ALTER COLUMN storage DROP DEFAULT`);
    await queryRunner.query(`
      ALTER TABLE "Segment"
      ALTER COLUMN storage TYPE segment_storage
      USING (UPPER(storage))::segment_storage
    `);
    await queryRunner.query(`ALTER TABLE "Segment" ALTER COLUMN storage SET DEFAULT 'R2'`);

    // ===== SEGMENT COUNT TRIGGERS =====
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
      $$ LANGUAGE plpgsql;
    `);

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

    // ===== REPORT TABLE =====
    await queryRunner.query(`
      CREATE TABLE "Report" (
        "id" SERIAL PRIMARY KEY,
        "report_type" report_type NOT NULL,
        "target_id" varchar NOT NULL,
        "reason" report_reason NOT NULL,
        "description" varchar(1000),
        "status" report_status NOT NULL DEFAULT 'PENDING',
        "admin_notes" varchar(1000),
        "resolved_at" timestamp,
        "user_id" int NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "resolved_by_id" int REFERENCES "User"("id") ON DELETE SET NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_report_type_target_id" ON "Report" ("report_type", "target_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_report_user_id" ON "Report" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_report_status" ON "Report" ("status")`);

    // ===== SEGMENT LISTS =====
    await queryRunner.query(`ALTER TYPE list_type ADD VALUE 'SEGMENT'`);

    await queryRunner.query(`
      CREATE TABLE "ListSegmentItem" (
        "id" SERIAL PRIMARY KEY,
        "list_id" int NOT NULL REFERENCES "List"("id") ON DELETE CASCADE,
        "segment_uuid" varchar NOT NULL,
        "media_id" int NOT NULL,
        "position" int NOT NULL,
        "note" varchar(500),
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      )
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_list_segment_item_list_uuid" ON "ListSegmentItem" ("list_id", "segment_uuid")`);
    await queryRunner.query(`CREATE INDEX "IDX_list_segment_item_list_position" ON "ListSegmentItem" ("list_id", "position")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Segment lists
    await queryRunner.query(`DROP TABLE "ListSegmentItem"`);
    // Note: PostgreSQL does not support removing enum values (SEGMENT from list_type)

    // Report table
    await queryRunner.query(`DROP TABLE "Report"`);

    // Triggers
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_segment_count_insert ON "Segment"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_segment_count_delete ON "Segment"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_segment_count_update ON "Segment"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS update_segment_counts()`);

    // Revert storage to varchar
    await queryRunner.query(`ALTER TABLE "Segment" ALTER COLUMN storage DROP DEFAULT`);
    await queryRunner.query(`
      ALTER TABLE "Segment"
      ALTER COLUMN storage TYPE varchar
      USING LOWER(storage::text)
    `);
    await queryRunner.query(`ALTER TABLE "Segment" ALTER COLUMN storage SET DEFAULT 'r2'`);

    // Revert status to smallint
    await queryRunner.query(`ALTER TABLE "Segment" ALTER COLUMN status DROP DEFAULT`);
    await queryRunner.query(`
      ALTER TABLE "Segment"
      ALTER COLUMN status TYPE smallint
      USING (
        CASE status
          WHEN 'DELETED' THEN 0
          WHEN 'ACTIVE' THEN 1
          WHEN 'SUSPENDED' THEN 2
          WHEN 'VERIFIED' THEN 3
          WHEN 'INVALID' THEN 100
          WHEN 'TOO_LONG' THEN 101
        END
      )::smallint
    `);
    await queryRunner.query(`ALTER TABLE "Segment" ALTER COLUMN status SET DEFAULT 1`);

    // Drop morphemes column
    await queryRunner.query(`ALTER TABLE "Segment" DROP COLUMN "morphemes"`);

    // Drop enum types
    await queryRunner.query(`DROP TYPE report_reason`);
    await queryRunner.query(`DROP TYPE report_status`);
    await queryRunner.query(`DROP TYPE report_type`);
    await queryRunner.query(`DROP TYPE segment_storage`);
    await queryRunner.query(`DROP TYPE segment_status`);
  }
}
