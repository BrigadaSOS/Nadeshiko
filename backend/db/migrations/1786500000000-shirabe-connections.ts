import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Where a reader's linked Shirabe account lives.
 *
 * Shirabe shapes a word lookup by the dictionary stack of whoever's key made the
 * call, and every call we make today is on one service key belonging to a
 * machine with no preferences. So every reader gets the same dictionaries,
 * whatever they configured over there. This table is what lets us ask as them.
 *
 * The token is stored encrypted (lib/secretBox.ts) rather than in the clear:
 * it is not ours, it is the reader's access to their own account on another
 * service, and a dump of this table must not be a pile of live credentials.
 * Only a digest would be better still, but we have to send it back verbatim on
 * every call, so there is nothing to compare a digest against.
 *
 * The stack is copied here beside it because it is read on EVERY lookup -- it is
 * what the cache key is built from -- while it changes about as often as someone
 * visits their settings page. Fetching it per request would put a Shirabe round
 * trip in front of a cache that exists to avoid one.
 *
 * NOT a column on `account` (better-auth's table). That one means "another way
 * to sign in to Nadeshiko"; this is a stored third-party credential, and
 * unlinking it must never be able to lock anybody out of their own account.
 */
export class ShirabeConnections1786500000000 implements MigrationInterface {
  name = 'ShirabeConnections1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ShirabeConnection" (
        "id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "token_ciphertext" text NOT NULL,
        "token_prefix" character varying(32) NOT NULL,
        "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "shirabe_name" character varying,
        "stack" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "stack_fingerprint" character varying(64),
        "stack_is_private" boolean NOT NULL DEFAULT false,
        "synced_at" timestamptz,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP DEFAULT now()
      )
    `);

    // One Shirabe account per reader. A second would be a second stack with no
    // way to say which one a lookup meant, so linking again replaces the link
    // rather than adding to it -- and the constraint is what makes that an
    // upsert instead of a race between two tabs.
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_shirabe_connection_user" ON "ShirabeConnection" ("user_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ShirabeConnection"`);
  }
}
