import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Whatever someone wanted to tell us, from wherever they were standing.
 *
 * Deliberately unstructured, and deliberately not a `Report`. A report names a
 * segment or a title and picks a reason from a list, because it feeds moderation
 * queues that act on that target. This table is the other half: the bug with no
 * obvious owner, the idea, the "this page is confusing" -- the things that have
 * nowhere to go in a form that insists on a target and a reason, and that
 * therefore never got sent at all.
 *
 * `user_id` is nullable and ON DELETE SET NULL, both on purpose. Anonymous
 * visitors can write here (that is the point -- the person most likely to hit a
 * broken sign-up is the one who is not signed in), and a message stays useful
 * after its sender deletes their account: it is a note about the product, not
 * personal data we are keeping about them. The `email` beside it is the reply
 * address they typed, kept only so an answer is possible.
 *
 * Everything from `page_path` down is context nobody types: where they were,
 * what locale the page rendered in, which build. It is the difference between
 * "the player is broken" and a bug we can reproduce.
 *
 * `handled_at` is a timestamp rather than a boolean so the queue can answer
 * "what is left" AND "when did we get to it", from one column.
 */
export class Feedback1786700000000 implements MigrationInterface {
  name = 'Feedback1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "Feedback" (
        "id" SERIAL PRIMARY KEY,
        "body" text NOT NULL,
        "email" character varying(320),
        "user_id" integer REFERENCES "User"("id") ON DELETE SET NULL,
        "page_path" text,
        "locale" character varying(16),
        "country" character varying(8),
        "user_agent" text,
        "ip_address" character varying(64),
        "app_version" character varying(32),
        "posthog_session_id" character varying(64),
        "posthog_distinct_id" character varying(128),
        "handled_at" timestamptz,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP DEFAULT now()
      )
    `);

    // Newest first is how this is always read, so the index carries the order.
    await queryRunner.query(`CREATE INDEX "IDX_feedback_created_at" ON "Feedback" ("created_at" DESC)`);

    // Partial, because the only question asked of `handled_at` is "which rows are
    // still NULL". A full index would spend most of its size on the answered ones,
    // which is the half nobody scans for.
    await queryRunner.query(
      `CREATE INDEX "IDX_feedback_unhandled" ON "Feedback" ("created_at" DESC) WHERE "handled_at" IS NULL`,
    );

    await queryRunner.query(`CREATE INDEX "IDX_feedback_user" ON "Feedback" ("user_id") WHERE "user_id" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "Feedback"`);
  }
}
