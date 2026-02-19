import { MigrationInterface, QueryRunner } from 'typeorm';

export class ActivityAnimeFields1740100000000 implements MigrationInterface {
  name = 'ActivityAnimeFields1740100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "UserActivity" ADD COLUMN "anime_name" varchar`);
    await queryRunner.query(`ALTER TABLE "UserActivity" ADD COLUMN "japanese_text" varchar`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "UserActivity" DROP COLUMN "japanese_text"`);
    await queryRunner.query(`ALTER TABLE "UserActivity" DROP COLUMN "anime_name"`);
  }
}
