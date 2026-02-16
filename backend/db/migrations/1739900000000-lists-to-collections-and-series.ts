import { MigrationInterface, QueryRunner } from 'typeorm';

export class ListsToCollectionsAndSeries1739900000000 implements MigrationInterface {
  name = 'ListsToCollectionsAndSeries1739900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ===== 1. CREATE SERIES TABLES =====
    await queryRunner.query(`
      CREATE TABLE "Series" (
        "id" SERIAL PRIMARY KEY,
        "name" varchar NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "SeriesMedia" (
        "id" SERIAL PRIMARY KEY,
        "series_id" int NOT NULL REFERENCES "Series"("id") ON DELETE CASCADE,
        "media_id" int NOT NULL REFERENCES "Media"("id") ON DELETE CASCADE,
        "position" int NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_series_media_series_media" ON "SeriesMedia" ("series_id", "media_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_series_media_series_position" ON "SeriesMedia" ("series_id", "position")`,
    );

    // ===== 2. MIGRATE SERIES-TYPE LISTS → Series + SeriesMedia =====
    await queryRunner.query(`
      INSERT INTO "Series" ("id", "name", "created_at", "updated_at")
      SELECT "id", "name", "created_at", "updated_at"
      FROM "List"
      WHERE "type" = 'SERIES'
    `);

    await queryRunner.query(`
      INSERT INTO "SeriesMedia" ("series_id", "media_id", "position", "created_at", "updated_at")
      SELECT li."list_id", li."media_id", li."position", li."created_at", li."updated_at"
      FROM "ListItem" li
      INNER JOIN "List" l ON l."id" = li."list_id"
      WHERE l."type" = 'SERIES'
    `);

    // Fix Series id sequence after explicit id insert
    await queryRunner.query(`
      SELECT setval(pg_get_serial_sequence('"Series"', 'id'), COALESCE((SELECT MAX(id) FROM "Series"), 0))
    `);

    // ===== 3. DROP ListItem TABLE =====
    // All ListItems were either SERIES (migrated above) or CUSTOM (being dropped)
    await queryRunner.query(`DROP TABLE "ListItem"`);

    // ===== 4. TRANSFORM List → Collection =====
    // Delete SERIES and CUSTOM type rows (only keep SEGMENT)
    await queryRunner.query(`DELETE FROM "List" WHERE "type" != 'SEGMENT'`);

    // Drop the type column
    await queryRunner.query(`ALTER TABLE "List" DROP COLUMN "type"`);

    // Rename table
    await queryRunner.query(`ALTER TABLE "List" RENAME TO "Collection"`);

    // ===== 5. TRANSFORM ListSegmentItem → CollectionSegment =====
    await queryRunner.query(`ALTER TABLE "ListSegmentItem" RENAME TO "CollectionSegment"`);
    await queryRunner.query(`ALTER TABLE "CollectionSegment" RENAME COLUMN "list_id" TO "collection_id"`);

    // Rename constraints and indexes
    await queryRunner.query(
      `ALTER INDEX "IDX_list_segment_item_list_uuid" RENAME TO "IDX_collection_segment_collection_uuid"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_list_segment_item_list_position" RENAME TO "IDX_collection_segment_collection_position"`,
    );

    // ===== 6. CLEANUP =====
    // Drop old list_type enum (no longer needed)
    await queryRunner.query(`DROP TYPE IF EXISTS list_type`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ===== RESTORE list_type enum =====
    await queryRunner.query(`CREATE TYPE list_type AS ENUM ('SERIES', 'CUSTOM', 'SEGMENT')`);

    // ===== RESTORE CollectionSegment → ListSegmentItem =====
    await queryRunner.query(
      `ALTER INDEX "IDX_collection_segment_collection_position" RENAME TO "IDX_list_segment_item_list_position"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_collection_segment_collection_uuid" RENAME TO "IDX_list_segment_item_list_uuid"`,
    );
    await queryRunner.query(`ALTER TABLE "CollectionSegment" RENAME COLUMN "collection_id" TO "list_id"`);
    await queryRunner.query(`ALTER TABLE "CollectionSegment" RENAME TO "ListSegmentItem"`);

    // ===== RESTORE Collection → List =====
    await queryRunner.query(`ALTER TABLE "Collection" RENAME TO "List"`);
    await queryRunner.query(`ALTER TABLE "List" ADD COLUMN "type" list_type NOT NULL DEFAULT 'SEGMENT'`);

    // ===== RESTORE ListItem table =====
    await queryRunner.query(`
      CREATE TABLE "ListItem" (
        "id" SERIAL PRIMARY KEY,
        "list_id" int NOT NULL REFERENCES "List"("id") ON DELETE CASCADE,
        "media_id" int NOT NULL REFERENCES "Media"("id"),
        "position" int NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_list_item_list_media" ON "ListItem" ("list_id", "media_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_list_item_list_position" ON "ListItem" ("list_id", "position")`);

    // ===== RESTORE Series → List + ListItem =====
    await queryRunner.query(`
      INSERT INTO "List" ("id", "name", "type", "user_id", "visibility", "created_at", "updated_at")
      SELECT "id", "name", 'SERIES', 1, 'PUBLIC', "created_at", "updated_at"
      FROM "Series"
    `);

    await queryRunner.query(`
      INSERT INTO "ListItem" ("list_id", "media_id", "position", "created_at", "updated_at")
      SELECT "series_id", "media_id", "position", "created_at", "updated_at"
      FROM "SeriesMedia"
    `);

    // ===== DROP Series tables =====
    await queryRunner.query(`DROP TABLE "SeriesMedia"`);
    await queryRunner.query(`DROP TABLE "Series"`);
  }
}
