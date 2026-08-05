import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The word popup stopped being an experiment.
 *
 * `showTokenHoverDefinitions` gated a popup that could only show a dictionary
 * form, a reading and a grammar label, which is why its description told anyone
 * using Yomitan to turn it off. Shirabe parses the corpus now and the popup
 * carries real definitions, so it ships to everyone, signed out included, and
 * the enrolments are meaningless rather than merely unused.
 */
export class RemoveTokenHoverLab1746500000000 implements MigrationInterface {
  name = 'RemoveTokenHoverLab1746500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "LabEnrollment" WHERE "lab_key" = 'showTokenHoverDefinitions'`);
  }

  public async down(): Promise<void> {
    // No-op: enrolments are user-driven and cannot be reconstructed.
  }
}
