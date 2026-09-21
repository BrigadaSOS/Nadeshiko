import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supports findLaterDuplicateSegmentIds(), which asks for many exact
 * (media_id, content) pairs among ACTIVE segments on every unscoped search.
 *
 * Without this index PostgreSQL scans the 4.8GB Segment table, often using
 * parallel workers. In production those scans averaged 1.6-4.6 seconds and
 * exhausted Docker's 64MB /dev/shm. INCLUDE makes the four-column projection
 * eligible for an index-only scan; the partial predicate avoids indexing rows
 * the reader path can never return.
 *
 * CONCURRENTLY is essential on the production-sized table, so this migration
 * opts out of TypeORM's per-migration transaction.
 */
export class IndexActiveSegmentDuplicates1789970000000 implements MigrationInterface {
  name = 'IndexActiveSegmentDuplicates1789970000000';
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('SET max_parallel_maintenance_workers = 0');
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_Segment_active_media_content"
      ON "Segment" ("media_id", "content")
      INCLUDE ("id", "episode")
      WHERE "status" = 'ACTIVE'
    `);
    await queryRunner.query('RESET max_parallel_maintenance_workers');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "IDX_Segment_active_media_content"`);
  }
}
