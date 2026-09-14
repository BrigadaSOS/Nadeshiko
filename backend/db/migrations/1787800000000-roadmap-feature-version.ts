import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RoadmapFeatureVersion1787800000000 implements MigrationInterface {
  name = 'RoadmapFeatureVersion1787800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RoadmapItem" ADD COLUMN IF NOT EXISTS "introduced_in_version" character varying(32)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "RoadmapItem" DROP COLUMN "introduced_in_version"`);
  }
}
