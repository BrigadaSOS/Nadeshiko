import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateReportTable1739580003000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE report_type AS ENUM ('SEGMENT', 'MEDIA')
    `);

    await queryRunner.query(`
      CREATE TYPE report_status AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'RESOLVED')
    `);

    await queryRunner.query(`
      CREATE TYPE report_reason AS ENUM (
        'WRONG_TRANSLATION', 'WRONG_TIMING', 'WRONG_AUDIO', 'NSFW_NOT_TAGGED', 'DUPLICATE_SEGMENT',
        'WRONG_METADATA', 'MISSING_EPISODES', 'WRONG_COVER_IMAGE',
        'INAPPROPRIATE_CONTENT', 'OTHER'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "Report" (
        "id" SERIAL PRIMARY KEY,
        "report_type" report_type NOT NULL,
        "target_id" varchar NOT NULL,
        "reason" report_reason NOT NULL,
        "description" varchar(1000),
        "status" report_status NOT NULL DEFAULT 'PENDING',
        "admin_notes" varchar(1000),
        "resolved_at" timestamp,
        "user_id" int NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "resolved_by_id" int REFERENCES "User"("id") ON DELETE SET NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_report_type_target_id" ON "Report" ("report_type", "target_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_report_user_id" ON "Report" ("user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_report_status" ON "Report" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "Report"`);
    await queryRunner.query(`DROP TYPE report_reason`);
    await queryRunner.query(`DROP TYPE report_status`);
    await queryRunner.query(`DROP TYPE report_type`);
  }
}
