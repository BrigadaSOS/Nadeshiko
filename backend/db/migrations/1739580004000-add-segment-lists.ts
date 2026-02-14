import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSegmentLists1739580004000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE list_type ADD VALUE 'SEGMENT'
    `);

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

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_list_segment_item_list_uuid" ON "ListSegmentItem" ("list_id", "segment_uuid")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_list_segment_item_list_position" ON "ListSegmentItem" ("list_id", "position")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "ListSegmentItem"`);
    // Note: PostgreSQL does not support removing enum values
  }
}
