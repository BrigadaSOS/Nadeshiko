import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records who made each segment edit and what triggered it.
 *
 * `SegmentRevision` already snapshots the pre-edit state, which is what makes a
 * revert possible. What it could not answer is provenance: the moderation agent
 * authenticates with a service API key bound to a real user row, so its edits
 * were indistinguishable from a human signing in as that account. The daily
 * digest and the spot-check both need "everything the agent did since X", and
 * neither can be derived after the fact from the key that happened to be current.
 *
 * `actor` defaults to HUMAN, which is the right reading of every row written
 * before this migration — the agent did not exist yet.
 *
 * `report_id` is `ON DELETE SET NULL`, not CASCADE: deleting a report must not
 * delete the record of the edit made because of it. The edit outlives its trigger.
 */
export class SegmentRevisionProvenance1786100100000 implements MigrationInterface {
  name = 'SegmentRevisionProvenance1786100100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "segment_revision_actor" AS ENUM ('HUMAN', 'AGENT')
    `);

    await queryRunner.query(`
      ALTER TABLE "SegmentRevision"
      ADD COLUMN "actor" "segment_revision_actor" NOT NULL DEFAULT 'HUMAN'
    `);

    await queryRunner.query(`
      ALTER TABLE "SegmentRevision"
      ADD COLUMN "report_id" integer REFERENCES "Report"("id") ON DELETE SET NULL
    `);

    // Serves the digest query: agent edits within a window, newest first.
    await queryRunner.query(`
      CREATE INDEX "IDX_SegmentRevision_actor_created_at"
      ON "SegmentRevision" ("actor", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_SegmentRevision_report_id" ON "SegmentRevision" ("report_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_SegmentRevision_report_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_SegmentRevision_actor_created_at"`);
    await queryRunner.query(`ALTER TABLE "SegmentRevision" DROP COLUMN IF EXISTS "report_id"`);
    await queryRunner.query(`ALTER TABLE "SegmentRevision" DROP COLUMN IF EXISTS "actor"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "segment_revision_actor"`);
  }
}
