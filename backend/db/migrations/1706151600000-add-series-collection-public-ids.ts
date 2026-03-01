import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSeriesCollectionPublicIds1706151600000 implements MigrationInterface {
  name = 'AddSeriesCollectionPublicIds1706151600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Series" ADD COLUMN "public_id" VARCHAR`);
    await queryRunner.query(`ALTER TABLE "Collection" ADD COLUMN "public_id" VARCHAR`);

    await queryRunner.query(`
      UPDATE "Series"
      SET "public_id" = substr(md5(random()::text || id::text), 1, 12)
      WHERE "public_id" IS NULL
    `);
    await queryRunner.query(`
      UPDATE "Collection"
      SET "public_id" = substr(md5(random()::text || id::text), 1, 12)
      WHERE "public_id" IS NULL
    `);

    await queryRunner.query(`ALTER TABLE "Series" ALTER COLUMN "public_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "Collection" ALTER COLUMN "public_id" SET NOT NULL`);

    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_Series_public_id" ON "Series" ("public_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_Collection_public_id" ON "Collection" ("public_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_Collection_public_id"`);
    await queryRunner.query(`DROP INDEX "IDX_Series_public_id"`);
    await queryRunner.query(`ALTER TABLE "Collection" DROP COLUMN "public_id"`);
    await queryRunner.query(`ALTER TABLE "Series" DROP COLUMN "public_id"`);
  }
}
