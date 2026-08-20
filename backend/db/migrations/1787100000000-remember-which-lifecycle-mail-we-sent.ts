import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One row per lifecycle email we have sent, which is what makes the nightly
 * sweep safe to run twice.
 *
 * The sweep asks "who registered seven days ago" and mails them. That question
 * has no memory: run it twice on the same night -- a deploy, a restart, a cron
 * that fired late and then on time -- and everybody in the window gets a second
 * copy. pg-boss's `singletonKey` does not close this, because it dedupes jobs
 * that are still queued and these are archived within the day; a month later it
 * knows nothing.
 *
 * WRITTEN WHEN THE JOB IS ENQUEUED, not when the send succeeds. That direction
 * is deliberate: a send that exhausts its retries leaves a row saying we tried,
 * and the reader never hears from us. The other way round, a crash between
 * sending and recording sends the same mail again. For a recap that is annoying;
 * for the feedback ask it is the second time we have asked the same person the
 * same question, which is exactly the shape of email people report as spam.
 *
 * `campaign` is what lets one `kind` recur. The day-7 note and the feedback ask
 * are once-ever per account and carry the kind alone; the recap is once per
 * month and carries `recap-2026-08`, so August and September are different rows
 * and neither can be sent twice.
 *
 * NOT A COLUMN ON `User`, and not `preferences`. This is an append-only log of
 * what we did, not a setting the reader owns -- mixing it into the preferences
 * blob would put our bookkeeping inside the object they can edit, and rewrite
 * the whole column on every send.
 */
export class RememberWhichLifecycleMailWeSent1787100000000 implements MigrationInterface {
  name = 'RememberWhichLifecycleMailWeSent1787100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "EmailLifecycleSend" (
        "id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL,
        "kind" character varying(32) NOT NULL,
        "campaign" character varying(64) NOT NULL,
        "sent_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP DEFAULT now()
      )
    `);

    // The guarantee itself, enforced by the database rather than by whoever
    // writes the next sweep. Two workers racing on the same night both reach the
    // insert; one of them loses here, and the loser skips the send rather than
    // discovering the duplicate after the mail has gone.
    //
    // `campaign` is in the key rather than beside it so a recurring kind stays
    // once-per-period: `(7, 'recap', 'recap-2026-08')` and
    // `(7, 'recap', 'recap-2026-09')` coexist, a second August recap cannot.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_email_lifecycle_send_unique" ON "EmailLifecycleSend" ("user_id", "kind", "campaign")`,
    );

    // The sweep's own lookup: "has this account had the win-back variant in the
    // last 90 days", which is a range scan per candidate rather than a point
    // lookup and so cannot lean on the unique index above.
    await queryRunner.query(
      `CREATE INDEX "IDX_email_lifecycle_send_kind_time" ON "EmailLifecycleSend" ("kind", "sent_at" DESC)`,
    );

    // An account that goes takes its history with it. Nothing here outlives the
    // reader it describes, and a deleted account must not leave rows that would
    // suppress mail to a future account with the same id.
    await queryRunner.query(
      `ALTER TABLE "EmailLifecycleSend" ADD CONSTRAINT "FK_email_lifecycle_send_user"
       FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "EmailLifecycleSend"`);
  }
}
