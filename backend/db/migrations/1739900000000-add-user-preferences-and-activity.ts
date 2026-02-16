import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserPreferencesAndActivity1739900000000 implements MigrationInterface {
  name = 'AddUserPreferencesAndActivity1739900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add preferences JSONB column to User
    await queryRunner.query(`
      ALTER TABLE "User" ADD COLUMN "preferences" jsonb NOT NULL DEFAULT '{}'
    `);

    // Create activity_type ENUM
    await queryRunner.query(`
      CREATE TYPE "activity_type" AS ENUM ('SEARCH', 'ANKI_EXPORT', 'SEGMENT_PLAY', 'LIST_ADD_SEGMENT')
    `);

    // Create UserActivity table
    await queryRunner.query(`
      CREATE TABLE "UserActivity" (
        "id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL,
        "activity_type" activity_type NOT NULL,
        "segment_uuid" varchar,
        "media_id" integer,
        "search_query" varchar,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        CONSTRAINT "FK_UserActivity_User" FOREIGN KEY ("user_id")
          REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);

    // Create indexes
    await queryRunner.query(`
      CREATE INDEX "IDX_UserActivity_userId_createdAt" ON "UserActivity" ("user_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_UserActivity_userId_activityType" ON "UserActivity" ("user_id", "activity_type")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "UserActivity"`);
    await queryRunner.query(`DROP TYPE "activity_type"`);
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "preferences"`);
  }
}
