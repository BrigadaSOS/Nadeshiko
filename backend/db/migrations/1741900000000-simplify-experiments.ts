import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SimplifyExperiments1741900000000 implements MigrationInterface {
  name = 'SimplifyExperiments1741900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "Experiment"`);

    await queryRunner.query(`DROP INDEX "IDX_experiment_enrollment_user_key"`);
    await queryRunner.query(`ALTER TABLE "ExperimentEnrollment" RENAME TO "LabEnrollment"`);
    await queryRunner.query(`ALTER TABLE "LabEnrollment" RENAME COLUMN "experiment_key" TO "lab_key"`);
    await queryRunner.query(`
      ALTER TABLE "LabEnrollment" RENAME CONSTRAINT "FK_ExperimentEnrollment_User" TO "FK_LabEnrollment_User"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_lab_enrollment_user_key" ON "LabEnrollment" ("user_id", "lab_key")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_lab_enrollment_user_key"`);
    await queryRunner.query(`ALTER TABLE "LabEnrollment" RENAME COLUMN "lab_key" TO "experiment_key"`);
    await queryRunner.query(`ALTER TABLE "LabEnrollment" RENAME TO "ExperimentEnrollment"`);
    await queryRunner.query(`
      ALTER TABLE "ExperimentEnrollment" RENAME CONSTRAINT "FK_LabEnrollment_User" TO "FK_ExperimentEnrollment_User"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_experiment_enrollment_user_key" ON "ExperimentEnrollment" ("user_id", "experiment_key")
    `);

    await queryRunner.query(`
      CREATE TABLE "Experiment" (
        "id" SERIAL PRIMARY KEY,
        "key" varchar NOT NULL UNIQUE CHECK ("key" <> ''),
        "name" varchar,
        "description" text,
        "enforced" boolean NOT NULL DEFAULT false,
        "enabled" boolean NOT NULL DEFAULT true,
        "rollout_percentage" integer NOT NULL DEFAULT 0,
        "allowed_user_ids" jsonb NOT NULL DEFAULT '[]',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ,
        CONSTRAINT "CHK_experiment_rollout_percentage" CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100)
      )
    `);
  }
}
