import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserFeaturesAndSegmentColumns1739800000000 implements MigrationInterface {
  name = 'UserFeaturesAndSegmentColumns1739800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ===== USER PREFERENCES =====
    await queryRunner.query(`ALTER TABLE "User" ADD COLUMN "preferences" jsonb NOT NULL DEFAULT '{}'`);

    // ===== USER ACTIVITY =====
    await queryRunner.query(
      `CREATE TYPE activity_type AS ENUM ('SEARCH', 'ANKI_EXPORT', 'SEGMENT_PLAY', 'LIST_ADD_SEGMENT')`,
    );

    await queryRunner.query(`
      CREATE TABLE "UserActivity" (
        "id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL,
        "activity_type" activity_type NOT NULL,
        "segment_uuid" varchar,
        "media_id" integer,
        "search_query" varchar,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        CONSTRAINT "FK_UserActivity_User" FOREIGN KEY ("user_id")
          REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_UserActivity_userId_createdAt" ON "UserActivity" ("user_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_UserActivity_userId_activityType" ON "UserActivity" ("user_id", "activity_type")`,
    );

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
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_list_segment_item_list_uuid" ON "ListSegmentItem" ("list_id", "segment_uuid")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_list_segment_item_list_position" ON "ListSegmentItem" ("list_id", "position")`,
    );

    // ===== SEGMENT COLUMN CHANGES =====
    // Replace is_nsfw with content_rating enum + rating_analysis
    await queryRunner.query(`CREATE TYPE content_rating AS ENUM ('SAFE', 'SUGGESTIVE', 'QUESTIONABLE', 'EXPLICIT')`);
    await queryRunner.query(`ALTER TABLE "Segment" DROP COLUMN "is_nsfw"`);
    await queryRunner.query(`ALTER TABLE "Segment" ADD COLUMN "content_rating" content_rating NOT NULL DEFAULT 'SAFE'`);
    await queryRunner.query(`ALTER TABLE "Segment" ADD COLUMN "rating_analysis" jsonb NULL`);

    // Add pos_analysis
    await queryRunner.query(`ALTER TABLE "Segment" ADD COLUMN "pos_analysis" jsonb NULL`);

    // Convert start_time/end_time from varchar (H:MM:SS.ffffff) to integer milliseconds
    await queryRunner.query(`
      ALTER TABLE "Segment"
        ADD COLUMN "start_time_ms" int,
        ADD COLUMN "end_time_ms" int
    `);
    await queryRunner.query(`
      UPDATE "Segment" SET
        start_time_ms = ROUND(EXTRACT(EPOCH FROM start_time::interval) * 1000)::int,
        end_time_ms = ROUND(EXTRACT(EPOCH FROM end_time::interval) * 1000)::int
    `);
    await queryRunner.query(`
      ALTER TABLE "Segment"
        ALTER COLUMN "start_time_ms" SET NOT NULL,
        ALTER COLUMN "end_time_ms" SET NOT NULL
    `);
    await queryRunner.query(`ALTER TABLE "Segment" DROP COLUMN "start_time"`);
    await queryRunner.query(`ALTER TABLE "Segment" DROP COLUMN "end_time"`);

    // Drop content_length column (now computed on the fly for ES indexing)
    await queryRunner.query(`ALTER TABLE "Segment" DROP COLUMN "content_length"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore content_length column
    await queryRunner.query(`ALTER TABLE "Segment" ADD COLUMN "content_length" int NOT NULL DEFAULT 0`);
    await queryRunner.query(`UPDATE "Segment" SET content_length = LENGTH(content)`);

    // Revert time columns: ms integers back to varchar
    await queryRunner.query(`ALTER TABLE "Segment" ADD COLUMN "start_time" varchar`);
    await queryRunner.query(`ALTER TABLE "Segment" ADD COLUMN "end_time" varchar`);
    await queryRunner.query(`
      UPDATE "Segment" SET
        start_time = (start_time_ms / 3600000)::int || ':' ||
          LPAD(((start_time_ms / 60000) % 60)::int::text, 2, '0') || ':' ||
          LPAD(((start_time_ms / 1000) % 60)::int::text, 2, '0') || '.' ||
          LPAD(((start_time_ms % 1000) * 1000)::int::text, 6, '0'),
        end_time = (end_time_ms / 3600000)::int || ':' ||
          LPAD(((end_time_ms / 60000) % 60)::int::text, 2, '0') || ':' ||
          LPAD(((end_time_ms / 1000) % 60)::int::text, 2, '0') || '.' ||
          LPAD(((end_time_ms % 1000) * 1000)::int::text, 6, '0')
    `);
    await queryRunner.query(`ALTER TABLE "Segment" DROP COLUMN "start_time_ms"`);
    await queryRunner.query(`ALTER TABLE "Segment" DROP COLUMN "end_time_ms"`);

    // Revert segment columns
    await queryRunner.query(`ALTER TABLE "Segment" DROP COLUMN "pos_analysis"`);
    await queryRunner.query(`ALTER TABLE "Segment" DROP COLUMN "rating_analysis"`);
    await queryRunner.query(`ALTER TABLE "Segment" DROP COLUMN "content_rating"`);
    await queryRunner.query(`DROP TYPE content_rating`);
    await queryRunner.query(`ALTER TABLE "Segment" ADD COLUMN "is_nsfw" boolean NOT NULL DEFAULT false`);

    // Drop segment lists
    await queryRunner.query(`DROP TABLE "ListSegmentItem"`);
    // Note: PostgreSQL does not support removing enum values (SEGMENT from list_type)

    // Drop user activity
    await queryRunner.query(`DROP TABLE "UserActivity"`);
    await queryRunner.query(`DROP TYPE activity_type`);

    // Drop user preferences
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "preferences"`);
  }
}
