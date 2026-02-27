import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SegmentRevisions1706151300000 implements MigrationInterface {
  name = 'SegmentRevisions1706151300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "SegmentRevision" (
        "id" SERIAL PRIMARY KEY,
        "segment_id" INT NOT NULL REFERENCES "Segment"("id") ON DELETE CASCADE,
        "revision_number" INT NOT NULL,
        "snapshot" JSONB NOT NULL,
        "user_id" INT REFERENCES "User"("id") ON DELETE SET NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE ("segment_id", "revision_number")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_SegmentRevision_segment_id"
      ON "SegmentRevision" ("segment_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "SegmentRevision"`);
  }
}
