import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the leftover non-cascading foreign key that has been breaking account
 * deletion for every account on the site.
 *
 * `Collection` carries TWO foreign keys on `user_id`, both pointing at
 * `User(id)`:
 *
 *   Collection_user_id_fkey   ON DELETE CASCADE
 *   Collection_user_fkey      (no action)   <- this one
 *
 * Postgres enforces every constraint on a table, so the cascading one never got
 * a chance to act: the non-cascading one refused the delete first. Since
 * `deleteUser` is enabled and `ensureDefaultCollections` gives every new account
 * two collections at sign-up, "delete my account" has been failing for
 * essentially everyone -- 644 of 644 accounts in production had a collection
 * when this was found. That is a right-to-erasure obligation, not a papercut,
 * which is why this is not being left for the next schema change to sweep up.
 *
 * HOW THE DUPLICATE HAPPENED, because the shape of the mistake is worth keeping.
 * `1706150900000-user-activity-and-collections.ts` created the table with the
 * constraint named `Collection_user_fkey`. `1742700000000-user-delete-cascade.ts`
 * then went to make the relationship cascade and dropped
 * `FK_Collection_user_id` and `Collection_user_id_fkey` before adding its own --
 * two plausible TypeORM-style names, neither of which was the one actually on
 * the table. `IF EXISTS` meant both drops passed silently, so the migration
 * reported success while adding a second constraint beside the first. It got
 * `ApiAuth` right in the same file, by naming `ApiAuth_user_fkey` explicitly.
 *
 * NOTHING IS LOST BY DROPPING IT. Both constraints police the same column
 * against the same target; they differ only in what happens to the child row
 * when the parent goes. Referential integrity is entirely preserved by
 * `Collection_user_id_fkey`, which stays.
 *
 * CHEAP AND NON-BLOCKING IN PRACTICE. Dropping a constraint is a catalogue
 * operation -- no table rewrite, no scan -- and it takes ACCESS EXCLUSIVE only
 * for the instant it takes to update the catalogue. `Collection` is ~1,300 rows
 * and 376 kB.
 *
 * IDEMPOTENT. `IF EXISTS` here is not the hazard it was in the migration that
 * caused this: that one used it on a *guessed* name, where a silent no-op meant
 * the job was not done. Here the name is the one confirmed to be on the table,
 * and the guard only covers a database provisioned after the fix.
 */
export class DropTheDuplicateCollectionUserFkey1787500000000 implements MigrationInterface {
  name = 'DropTheDuplicateCollectionUserFkey1787500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Collection" DROP CONSTRAINT IF EXISTS "Collection_user_fkey"`);
  }

  /**
   * Restores the constraint, which restores the bug -- deliberately. A `down`
   * exists to return the schema to what it was, not to a state somebody
   * preferred; a migration that reverts to a different shape than it found is
   * the harder thing to reason about later.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Collection" ADD CONSTRAINT "Collection_user_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id")`,
    );
  }
}
