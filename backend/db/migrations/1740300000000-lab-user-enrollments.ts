import { MigrationInterface, QueryRunner } from 'typeorm';

export class LabUserEnrollments1740300000000 implements MigrationInterface {
  name = 'LabUserEnrollments1740300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "LabUserEnrollment" (
        "id" SERIAL PRIMARY KEY,
        "user_id" int NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "feature_key" varchar NOT NULL,
        "enrolled_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_lab_user_enrollment_user_feature"
      ON "LabUserEnrollment" ("user_id", "feature_key")
    `);

    await queryRunner.query(`
      INSERT INTO "LabUserEnrollment" ("user_id", "feature_key", "enrolled_at")
      SELECT u."id", lab.key, now()
      FROM "User" u,
           LATERAL jsonb_each_text(COALESCE(u."preferences" -> 'labs', '{}'::jsonb)) AS lab(key, value)
      WHERE lab.value = 'true'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "LabUserEnrollment"`);
  }
}
