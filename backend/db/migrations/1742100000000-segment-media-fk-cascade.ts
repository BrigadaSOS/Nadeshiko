import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SegmentMediaFkCascade1742100000000 implements MigrationInterface {
  name = 'SegmentMediaFkCascade1742100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Segment" DROP CONSTRAINT "Segment_media_fkey"`);
    await queryRunner.query(
      `ALTER TABLE "Segment" ADD CONSTRAINT "Segment_media_fkey" FOREIGN KEY ("media_id") REFERENCES "Media"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Segment" DROP CONSTRAINT "Segment_media_fkey"`);
    await queryRunner.query(
      `ALTER TABLE "Segment" ADD CONSTRAINT "Segment_media_fkey" FOREIGN KEY ("media_id") REFERENCES "Media"("id")`,
    );
  }
}
