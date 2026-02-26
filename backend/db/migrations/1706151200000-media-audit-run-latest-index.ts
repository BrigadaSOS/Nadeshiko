import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MediaAuditRunLatestIndex1706151200000 implements MigrationInterface {
  name = 'MediaAuditRunLatestIndex1706151200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_MediaAuditRun_audit_name_created_at_id"
      ON "MediaAuditRun" ("audit_name", "created_at" DESC, "id" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_MediaAuditRun_audit_name_created_at_id"`);
  }
}
