import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeriesLocalizedNames1740000000000 implements MigrationInterface {
  name = 'SeriesLocalizedNames1740000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Series" ADD COLUMN "name_japanese" varchar`);
    await queryRunner.query(`ALTER TABLE "Series" ADD COLUMN "name_romaji" varchar`);
    await queryRunner.query(`ALTER TABLE "Series" ADD COLUMN "name_english" varchar`);

    await queryRunner.query(`
      UPDATE "Series"
      SET
        "name_japanese" = "name",
        "name_romaji" = "name",
        "name_english" = "name"
    `);

    await queryRunner.query(`ALTER TABLE "Series" ALTER COLUMN "name_japanese" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "Series" ALTER COLUMN "name_romaji" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "Series" ALTER COLUMN "name_english" SET NOT NULL`);

    await queryRunner.query(`ALTER TABLE "Series" DROP COLUMN "name"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Series" ADD COLUMN "name" varchar`);
    await queryRunner.query(`
      UPDATE "Series"
      SET "name" = COALESCE(NULLIF("name_english", ''), NULLIF("name_romaji", ''), "name_japanese")
    `);
    await queryRunner.query(`ALTER TABLE "Series" ALTER COLUMN "name" SET NOT NULL`);

    await queryRunner.query(`ALTER TABLE "Series" DROP COLUMN "name_english"`);
    await queryRunner.query(`ALTER TABLE "Series" DROP COLUMN "name_romaji"`);
    await queryRunner.query(`ALTER TABLE "Series" DROP COLUMN "name_japanese"`);
  }
}
