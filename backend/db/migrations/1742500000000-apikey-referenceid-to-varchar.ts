import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ApikeyReferenceidToVarchar1742500000000 implements MigrationInterface {
  name = 'ApikeyReferenceidToVarchar1742500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // better-auth treats user IDs as strings internally.
    // With generateId: 'serial', session.user.id is a string ("2") but
    // referenceId was stored as integer (2). The api-key/list endpoint
    // uses strict equality (===) which fails: 2 !== "2".
    // Drop the FK since varchar cannot reference integer; better-auth
    // manages the relationship at the application level.
    await queryRunner.query(`ALTER TABLE "apikey" DROP CONSTRAINT IF EXISTS "apikey_user_fkey"`);
    await queryRunner.query(`ALTER TABLE "apikey" ALTER COLUMN "referenceId" TYPE varchar USING "referenceId"::varchar`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "apikey" ALTER COLUMN "referenceId" TYPE integer USING "referenceId"::integer`);
    await queryRunner.query(`
      ALTER TABLE "apikey"
        ADD CONSTRAINT "apikey_user_fkey"
        FOREIGN KEY ("referenceId") REFERENCES "User"(id) ON DELETE CASCADE
    `);
  }
}
