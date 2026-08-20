import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The return path for outbound mail, which until now did not exist.
 *
 * We hand messages to ZeptoMail over SMTP and hear nothing back: no webhook, no
 * suppression list, no metric with `email` in its name. So the app cannot answer
 * whether a magic link arrived, whether an address has ever bounced, what our
 * bounce rate is, or whether anybody is complaining. Zoho can answer all four,
 * in a console nobody has open at 3am.
 *
 * That blindness has teeth here rather than being cosmetic. Magic link is a
 * sign-in path, so a silently undeliverable address is a locked account with no
 * error message. And the ceiling is not ours to set: Zoho's terms put bounces
 * under 5% and complaints under 0.1% and reserve the right to block the sending
 * Agent, with an unblock path that runs through a support form.
 *
 * TWO TABLES, because they answer different questions and age differently.
 * `EmailEvent` is the forensic log -- every event, kept whole, never edited.
 * `EmailSuppression` is the decision -- one row per address we will not write to
 * again. Deriving the second from the first on every send would be a scan of a
 * growing log to answer a question that has one row's worth of answer.
 *
 * A SUPPRESSION IS A ROW, NOT A FLAG ON `User`. Most of what bounces is not a
 * user yet: a magic link to a typo'd address is refused before an account
 * exists, and the address is the subject of the record, not the account.
 */
export class LearnWhenAnEmailBounces1787000000000 implements MigrationInterface {
  name = 'LearnWhenAnEmailBounces1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "EmailEvent" (
        "id" SERIAL PRIMARY KEY,
        "address" character varying(320) NOT NULL,
        "event" character varying(32) NOT NULL,
        "reason" text,
        "diagnostic_message" text,
        "email_reference" character varying(128),
        "client_reference" character varying(128),
        "webhook_request_id" character varying(128),
        "occurred_at" timestamptz NOT NULL,
        "payload" jsonb NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP DEFAULT now()
      )
    `);

    // The idempotency key. ZeptoMail's retry behaviour is undocumented, so the
    // same event arriving twice has to be a no-op rather than a second bounce.
    //
    // PARTIAL, because `webhook_request_id` is the provider's id and a payload
    // has turned up without one before. A plain unique index would collapse
    // every such event to a single row per address; a partial one lets the
    // unattributable ones through rather than silently dropping them.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_email_event_webhook_request" ON "EmailEvent" ("webhook_request_id", "address")
       WHERE "webhook_request_id" IS NOT NULL`,
    );

    // "What happened to this address" is the question asked when somebody says
    // they never got the email, which is the only time anybody reads this table
    // by hand.
    await queryRunner.query(`CREATE INDEX "IDX_email_event_address" ON "EmailEvent" ("address", "occurred_at" DESC)`);

    // Counting soft bounces inside a rolling window is the one query on a hot
    // path: it runs on every soft bounce to decide whether this is the fifth.
    await queryRunner.query(`CREATE INDEX "IDX_email_event_event_time" ON "EmailEvent" ("event", "occurred_at" DESC)`);

    await queryRunner.query(`
      CREATE TABLE "EmailSuppression" (
        "id" SERIAL PRIMARY KEY,
        "address" character varying(320) NOT NULL,
        "cause" character varying(32) NOT NULL,
        "reason" text,
        "suppressed_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP DEFAULT now()
      )
    `);

    // One row per address, enforced by the database rather than by whoever
    // writes the next insert. Addresses are normalized to lowercase before they
    // get here, so this is a real uniqueness guarantee and not a case-sensitive
    // near-miss.
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_email_suppression_address" ON "EmailSuppression" ("address")`);

    // The suppression gauge groups by cause on every scrape.
    await queryRunner.query(`CREATE INDEX "IDX_email_suppression_cause" ON "EmailSuppression" ("cause")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "EmailSuppression"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "EmailEvent"`);
  }
}
