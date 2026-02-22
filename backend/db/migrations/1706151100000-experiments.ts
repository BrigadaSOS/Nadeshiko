import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Experiments1706151100000 implements MigrationInterface {
  name = 'Experiments1706151100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ===== EXPERIMENT =====
    await queryRunner.query(`
      CREATE TABLE "Experiment" (
        "id" SERIAL PRIMARY KEY,
        "key" varchar NOT NULL UNIQUE,
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

    // ===== EXPERIMENT ENROLLMENT =====
    await queryRunner.query(`
      CREATE TABLE "ExperimentEnrollment" (
        "id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL,
        "experiment_key" varchar NOT NULL,
        "enrolled_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ,
        CONSTRAINT "FK_ExperimentEnrollment_User" FOREIGN KEY ("user_id")
          REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_experiment_enrollment_user_key"
        ON "ExperimentEnrollment" ("user_id", "experiment_key")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "ExperimentEnrollment"`);
    await queryRunner.query(`DROP TABLE "Experiment"`);
  }
}
