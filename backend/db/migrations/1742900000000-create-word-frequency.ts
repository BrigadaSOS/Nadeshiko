import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWordFrequency1742900000000 implements MigrationInterface {
  name = 'CreateWordFrequency1742900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "WordFrequency" (
        "rank" INT PRIMARY KEY,
        "word" VARCHAR(50) NOT NULL,
        "reading" VARCHAR(50),
        "match_count" INT NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_WordFrequency_word" ON "WordFrequency" ("word")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_WordFrequency_word"`);
    await queryRunner.query(`DROP TABLE "WordFrequency"`);
  }
}
