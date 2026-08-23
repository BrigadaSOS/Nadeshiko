import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Where an account was opened, and where it is being used.
 *
 * Two questions that looked like one until we tried to answer either. Analytics
 * cannot answer the first: `account_created` is captured server-side, so its
 * geoip resolves to our own host and every sign-up in the project looks
 * Finnish. It cannot answer the second either, because the browser-side country
 * belongs to a visitor, not to an account -- and the visitors are mostly not
 * people. A single burst of one-pageview, zero-second identities out of one
 * city can outnumber the real readers of a country several hundred to one, so a
 * count of "visitors from X" says nothing about whether anyone from X has an
 * account.
 *
 * These two columns are the account-linked answer, and their value is precisely
 * that they cannot be inflated that way: an automated client that never signs
 * in never gets a row here.
 *
 * `User.signup_country` IS THE DURABLE ONE. It is written once at account
 * creation and never expires, which matters because nothing else in the schema
 * remembers a sign-up's origin -- better-auth deletes the `verification` row
 * the moment the magic link is consumed, so the request that knew the answer is
 * gone within minutes. This is also why there is no backfill: for accounts that
 * already exist the information was never written down, and inferring it from
 * the oldest surviving session would date a sign-up to whenever that reader
 * last happened to log in. Existing rows keep null, and null here means "opened
 * before we recorded this", not "unknown country".
 *
 * `session.country` IS THE PERISHABLE ONE. One row per device, and only for as
 * long as the session lives: sessions expire after 30 days and are deleted, and
 * `updated_at` refreshes on a 7-day sliding window, so this is a rough "lately",
 * never a history. Read it as a current picture and never as a timeline.
 *
 * Both are nullable with no default. Every path that fills them tolerates the
 * header being absent -- see `countryFromHeaders` -- because a sign-in must not
 * fail over a column that exists to satisfy curiosity.
 *
 * TWO LETTERS, AND NOTHING ELSE. `CF-IPCountry` carries no city, region or
 * coordinates, and the columns are sized so nobody is tempted to widen the
 * scope later without saying so.
 */
export class RememberWhereAnAccountSignsInFrom1787300000000 implements MigrationInterface {
  name = 'RememberWhereAnAccountSignsInFrom1787300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" ADD COLUMN "signup_country" character varying(2)`);
    await queryRunner.query(`ALTER TABLE "session" ADD COLUMN "country" character varying(2)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "session" DROP COLUMN "country"`);
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "signup_country"`);
  }
}
