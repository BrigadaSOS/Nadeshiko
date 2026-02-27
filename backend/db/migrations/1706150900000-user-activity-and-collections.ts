import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UserActivityAndCollections1706150900000 implements MigrationInterface {
  name = 'UserActivityAndCollections1706150900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "UserActivity" (
        "id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL,
        "activity_type" activity_type NOT NULL,
        "segment_uuid" varchar,
        "media_id" integer,
        "search_query" varchar,
        "anime_name" varchar,
        "japanese_text" varchar,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ,
        CONSTRAINT "FK_UserActivity_User" FOREIGN KEY ("user_id")
          REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_UserActivity_userId_createdAt" ON "UserActivity" ("user_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_UserActivity_userId_activityType" ON "UserActivity" ("user_id", "activity_type")
    `);

    await queryRunner.query(`
      CREATE TABLE "Collection" (
        "id" SERIAL PRIMARY KEY,
        "name" varchar NOT NULL CHECK ("name" <> ''),
        "user_id" integer NOT NULL,
        "collection_type" collection_type NOT NULL DEFAULT 'USER',
        "visibility" collection_visibility NOT NULL DEFAULT 'PRIVATE',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ,
        CONSTRAINT "Collection_user_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_Collection_user_id" ON "Collection" ("user_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "CollectionSegment" (
        "id" SERIAL PRIMARY KEY,
        "collection_id" integer NOT NULL,
        "segment_uuid" varchar NOT NULL CHECK ("segment_uuid" <> ''),
        "media_id" integer NOT NULL,
        "position" integer NOT NULL,
        "note" varchar(500),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ,
        CONSTRAINT "CollectionSegment_collection_fkey" FOREIGN KEY ("collection_id")
          REFERENCES "Collection"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_collection_segment_collection_uuid"
        ON "CollectionSegment" ("collection_id", "segment_uuid")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_collection_segment_collection_position"
        ON "CollectionSegment" ("collection_id", "position")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "CollectionSegment"`);
    await queryRunner.query(`DROP TABLE "Collection"`);
    await queryRunner.query(`DROP TABLE "UserActivity"`);
  }
}
