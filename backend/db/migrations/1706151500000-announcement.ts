import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Announcement1706151500000 implements MigrationInterface {
  name = 'Announcement1706151500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "Announcement" (
        "id" SERIAL PRIMARY KEY,
        "message" text NOT NULL CHECK ("message" <> ''),
        "type" varchar(20) NOT NULL DEFAULT 'info' CHECK ("type" IN ('info', 'warning', 'maintenance')),
        "active" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "Announcement"`);
  }
}
