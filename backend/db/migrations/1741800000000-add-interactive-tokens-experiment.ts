import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInteractiveTokensExperiment1741800000000 implements MigrationInterface {
  name = 'AddInteractiveTokensExperiment1741800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "Experiment" ("key", "name", "description", "enforced", "enabled", "rollout_percentage", "allowed_user_ids")
      VALUES (
        'interactive-tokens',
        'Interactive Tokens & Enhanced Highlighting',
        'Break Japanese sentences into clickable word tokens and extend search highlights to cover full conjugated forms.',
        false,
        true,
        100,
        '[]'
      )
      ON CONFLICT ("key") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "Experiment" WHERE "key" = 'interactive-tokens'`);
  }
}
