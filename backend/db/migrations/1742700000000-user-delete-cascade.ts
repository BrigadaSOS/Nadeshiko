import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UserDeleteCascade1742700000000 implements MigrationInterface {
  name = 'UserDeleteCascade1742700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Collection" DROP CONSTRAINT IF EXISTS "FK_Collection_user_id"`);
    await queryRunner.query(`ALTER TABLE "Collection" DROP CONSTRAINT IF EXISTS "Collection_user_id_fkey"`);
    await queryRunner.query(
      `ALTER TABLE "Collection" ADD CONSTRAINT "Collection_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(`ALTER TABLE "ApiAuth" DROP CONSTRAINT IF EXISTS "ApiAuth_user_fkey"`);
    await queryRunner.query(
      `ALTER TABLE "ApiAuth" ADD CONSTRAINT "ApiAuth_user_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(`ALTER TABLE "Report" DROP CONSTRAINT IF EXISTS "FK_Report_user_id"`);
    await queryRunner.query(`ALTER TABLE "Report" DROP CONSTRAINT IF EXISTS "Report_user_id_fkey"`);
    await queryRunner.query(
      `ALTER TABLE "Report" ADD CONSTRAINT "Report_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Collection" DROP CONSTRAINT "Collection_user_id_fkey"`);
    await queryRunner.query(
      `ALTER TABLE "Collection" ADD CONSTRAINT "Collection_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id")`,
    );

    await queryRunner.query(`ALTER TABLE "ApiAuth" DROP CONSTRAINT "ApiAuth_user_fkey"`);
    await queryRunner.query(
      `ALTER TABLE "ApiAuth" ADD CONSTRAINT "ApiAuth_user_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id")`,
    );

    await queryRunner.query(`ALTER TABLE "Report" DROP CONSTRAINT "Report_user_id_fkey"`);
    await queryRunner.query(
      `ALTER TABLE "Report" ADD CONSTRAINT "Report_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id")`,
    );
  }
}
