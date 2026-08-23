import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * When an account was last used, and from where.
 *
 * Nothing recorded this. `User.modified_at` and `updated_at` move on any
 * profile write, so neither means "signed in", and the nearest proxy --
 * `UserActivity.createdAt` -- is unusable for it twice over: the retention
 * worker deletes it after 90 days, and readers can switch it off entirely
 * through `preferences.searchHistory`, so it is simply absent for anyone who
 * did. The only thing that actually knew was the `session` table, and it knew
 * by accident: sessions are never swept, so expired rows pile up and become a
 * de-facto access log.
 *
 * That accident is what these columns replace. A session sweep is coming, and
 * when it lands the accidental history goes with it -- so the signal worth
 * keeping is lifted out first, into two columns that are one row per user,
 * durable, and hold no address.
 *
 * WHAT `last_seen_at` MEANS, PRECISELY. It is written when a session is created
 * and when one is refreshed, and better-auth only refreshes past `updateAge`,
 * which is seven days. So this is accurate to within a week, not to the minute,
 * and a reader active every day moves it roughly weekly. That is deliberate:
 * the alternative is a write to `User` on every authenticated request, which
 * costs far more than the precision is worth. Read it as "active around then",
 * never as a timestamp of anything.
 *
 * `last_seen_country` CAN LAG `last_seen_at`. It is only overwritten when the
 * request actually carried a country, so a sign-in from somewhere Cloudflare
 * could not place leaves the previous country standing rather than nulling it.
 * It means "the last place we could identify", which is the useful reading, but
 * it is not necessarily where the reader was at `last_seen_at`.
 *
 * IMPERSONATION DOES NOT COUNT. An admin acting as another account is not that
 * account being used, and letting it move these columns would quietly corrupt
 * the one thing they exist to say. The hook skips impersonated sessions.
 *
 * Both nullable, no backfill. Existing accounts stay null until their next
 * sign-in or refresh -- and `scripts/backfill-session-country.ts` is what seeds
 * the historical answer out of the session rows, which has to happen BEFORE any
 * sweep deletes them.
 */
export class RememberWhenAnAccountWasLastSeen1787400000000 implements MigrationInterface {
  name = 'RememberWhenAnAccountWasLastSeen1787400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" ADD COLUMN "last_seen_at" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "User" ADD COLUMN "last_seen_country" character varying(2)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "last_seen_country"`);
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "last_seen_at"`);
  }
}
