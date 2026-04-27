import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveInteractiveTokensLab1746000000000 implements MigrationInterface {
  name = 'RemoveInteractiveTokensLab1746000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "LabEnrollment" WHERE "lab_key" = 'interactive-tokens'`);
  }

  public async down(): Promise<void> {
    // No-op: enrollments are user-driven and cannot be reconstructed.
  }
}
