import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExperimentsRefactor1740600000000 implements MigrationInterface {
  name = 'ExperimentsRefactor1740600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Rename LabUserEnrollment → ExperimentEnrollment
    await queryRunner.query(`ALTER TABLE "LabUserEnrollment" RENAME TO "ExperimentEnrollment"`);
    await queryRunner.query(`ALTER TABLE "ExperimentEnrollment" RENAME COLUMN "feature_key" TO "experiment_key"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lab_user_enrollment_user_feature"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_experiment_enrollment_user_key"
      ON "ExperimentEnrollment" ("user_id", "experiment_key")
    `);

    // Create Experiment table
    await queryRunner.query(`
      CREATE TABLE "Experiment" (
        "id" SERIAL PRIMARY KEY,
        "key" varchar NOT NULL UNIQUE,
        "name" varchar NULL,
        "description" text NULL,
        "enforced" boolean NOT NULL DEFAULT false,
        "enabled" boolean NOT NULL DEFAULT true,
        "rollout_percentage" int NOT NULL DEFAULT 0,
        CONSTRAINT "CHK_experiment_rollout_percentage" CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
        "allowed_user_ids" jsonb NOT NULL DEFAULT '[]',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "Experiment"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_experiment_enrollment_user_key"`);
    await queryRunner.query(`ALTER TABLE "ExperimentEnrollment" RENAME COLUMN "experiment_key" TO "feature_key"`);
    await queryRunner.query(`ALTER TABLE "ExperimentEnrollment" RENAME TO "LabUserEnrollment"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_lab_user_enrollment_user_feature"
      ON "LabUserEnrollment" ("user_id", "feature_key")
    `);
  }
}
