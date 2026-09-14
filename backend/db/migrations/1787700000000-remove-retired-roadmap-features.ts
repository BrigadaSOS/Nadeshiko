import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveRetiredRoadmapFeatures1787700000000 implements MigrationInterface {
  name = 'RemoveRetiredRoadmapFeatures1787700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "RoadmapItem"
      WHERE "kind" = 'FEATURE'
        AND "title" IN ('Title pages', 'Lifecycle email controls', 'Copy sentences with furigana', 'Email sign-in codes')
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // These roadmap entries were intentionally retired and are not restored.
  }
}
