import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProfileActivityAndCollectionScopes1743500000000 implements MigrationInterface {
  name = 'AddProfileActivityAndCollectionScopes1743500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "api_permission_enum" ADD VALUE IF NOT EXISTS 'READ_PROFILE'`);
    await queryRunner.query(`ALTER TYPE "api_permission_enum" ADD VALUE IF NOT EXISTS 'WRITE_PROFILE'`);
    await queryRunner.query(`ALTER TYPE "api_permission_enum" ADD VALUE IF NOT EXISTS 'READ_ACTIVITY'`);
    await queryRunner.query(`ALTER TYPE "api_permission_enum" ADD VALUE IF NOT EXISTS 'WRITE_ACTIVITY'`);

    await queryRunner.query(`ALTER TYPE "api_permission_enum" RENAME VALUE 'READ_LISTS' TO 'READ_COLLECTIONS'`);
    await queryRunner.query(`ALTER TYPE "api_permission_enum" RENAME VALUE 'CREATE_LISTS' TO 'CREATE_COLLECTIONS'`);
    await queryRunner.query(`ALTER TYPE "api_permission_enum" RENAME VALUE 'UPDATE_LISTS' TO 'UPDATE_COLLECTIONS'`);
    await queryRunner.query(`ALTER TYPE "api_permission_enum" RENAME VALUE 'DELETE_LISTS' TO 'DELETE_COLLECTIONS'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "api_permission_enum" RENAME VALUE 'READ_COLLECTIONS' TO 'READ_LISTS'`);
    await queryRunner.query(`ALTER TYPE "api_permission_enum" RENAME VALUE 'CREATE_COLLECTIONS' TO 'CREATE_LISTS'`);
    await queryRunner.query(`ALTER TYPE "api_permission_enum" RENAME VALUE 'UPDATE_COLLECTIONS' TO 'UPDATE_LISTS'`);
    await queryRunner.query(`ALTER TYPE "api_permission_enum" RENAME VALUE 'DELETE_COLLECTIONS' TO 'DELETE_LISTS'`);
  }
}
