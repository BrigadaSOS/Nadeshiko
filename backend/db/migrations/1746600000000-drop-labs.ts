import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the labs feature.
 *
 * Labs let a signed-in user opt into an in-progress feature. Both experiments
 * that used it have since shipped to everyone, leaving an empty feature list, a
 * settings tab that rendered nothing and two API endpoints that returned `[]`.
 * Staging plus local flags cover the same need without a per-user opt-in stored
 * in Postgres.
 *
 * The table is dropped rather than left behind: it is unreferenced by any entity
 * after this change, so leaving it would strand a table nothing maintains.
 */
export class DropLabs1746600000000 implements MigrationInterface {
  name = 'DropLabs1746600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "LabEnrollment"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreates the shape only. Enrolments are user-driven and cannot be
    // reconstructed, and by the time this ran both labs were already retired,
    // so the table was empty.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "LabEnrollment" (
        "id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL,
        "lab_key" character varying NOT NULL,
        "enrolled_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "UQ_LabEnrollment_user_lab" UNIQUE ("user_id", "lab_key"),
        CONSTRAINT "FK_LabEnrollment_user" FOREIGN KEY ("user_id")
          REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);
  }
}
