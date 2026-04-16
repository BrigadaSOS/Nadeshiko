import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CollectionSegmentCascade1743100000000 implements MigrationInterface {
  name = 'CollectionSegmentCascade1743100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CollectionSegment" DROP CONSTRAINT IF EXISTS "CollectionSegment_segment_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CollectionSegment" ADD CONSTRAINT "CollectionSegment_segment_fkey" FOREIGN KEY ("segment_id") REFERENCES "Segment"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "CollectionSegment" DROP CONSTRAINT "CollectionSegment_segment_fkey"`);
    await queryRunner.query(
      `ALTER TABLE "CollectionSegment" ADD CONSTRAINT "CollectionSegment_segment_fkey" FOREIGN KEY ("segment_id") REFERENCES "Segment"("id")`,
    );
  }
}
