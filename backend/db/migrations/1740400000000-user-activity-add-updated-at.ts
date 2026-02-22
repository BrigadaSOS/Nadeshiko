import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserActivityAddUpdatedAt1740400000000 implements MigrationInterface {
  name = 'UserActivityAddUpdatedAt1740400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "UserActivity" ADD COLUMN "updated_at" timestamp DEFAULT now()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "UserActivity" DROP COLUMN "updated_at"`);
  }
}
