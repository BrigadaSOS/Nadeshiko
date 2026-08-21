import { Entity, PrimaryColumn, Column, Index, OneToOne, JoinColumn } from 'typeorm';
import type { User } from './User';
import { BaseEntity } from './base.entity';

/**
 * A reader's Shirabe account, linked to their Nadeshiko one.
 *
 * What it is FOR, and the whole reason it holds a credential at all: Shirabe
 * shapes a word lookup by the dictionary stack of whoever's key made the call.
 * On our own service key that is a machine with no preferences, so every reader
 * sees the same dictionaries. With this row we can ask as THEM, and the popup
 * answers from the dictionaries they configured, in their order.
 *
 * Deliberately NOT better-auth's `account` table, even though that is where an
 * OAuth token would normally land. That table means "another way to sign in to
 * Nadeshiko", and this is not one: you cannot log in here with Shirabe, and
 * unlinking must never be able to lock someone out of their own account. The
 * paths that would blur the two (`/link-social`, `/list-accounts`,
 * `/unlink-account`, `/get-access-token`) are switched off in config/auth.ts on
 * purpose. This is a stored third-party credential, which is its own thing.
 *
 * One row per user: a second Shirabe account would be a second stack with no way
 * to say which one a lookup meant, so linking again replaces the link.
 */
@Entity('ShirabeConnection')
export class ShirabeConnection extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Index({ unique: true })
  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  /**
   * The reader's Shirabe credentials, encrypted at rest (see lib/secretBox.ts).
   *
   * An OAuth token pair, under a grant the reader approved on Shirabe's consent
   * screen and can revoke from their access list. The ACCESS token is what a
   * lookup sends, and it lives a month: `accessTokenExpiresAt` is what tells the
   * credential route to renew it before handing it out. The REFRESH token is
   * what renews it, single-use and replaced on every renewal, good for ninety
   * days from its last use. Both are theirs, not ours: they can read their
   * account and, if they ever grant the scopes for it, write to their study
   * data. A dump of this table must not be a pile of live credentials for
   * somebody else's service.
   */
  @Column({ name: 'access_token_ciphertext', type: 'text' })
  accessTokenCiphertext!: string;

  @Column({ name: 'access_token_expires_at', type: 'timestamptz' })
  accessTokenExpiresAt!: Date;

  @Column({ name: 'refresh_token_ciphertext', type: 'text' })
  refreshTokenCiphertext!: string;

  @Column({ name: 'scopes', type: 'jsonb', default: () => "'[]'::jsonb" })
  scopes!: string[];

  /** Who they are over there, so the settings page can say so. */
  @Column({ name: 'shirabe_name', type: 'varchar', nullable: true })
  shirabeName?: string | null;

  /**
   * Their dictionary stack as Shirabe resolved it, and the two facts about it a
   * cache needs. `stackFingerprint` names the ANSWERS this stack produces, so
   * two readers carrying the same one may share a cached lookup and a
   * dictionary re-import retires both copies at once. `stackIsPrivate` is set
   * when the stack names one of their own uploads, which makes its answers
   * theirs alone and must not be shared with anybody.
   *
   * Copied here rather than fetched per request because it is read on EVERY
   * lookup (it is what the cache key is built from) and changes about as often
   * as a person visits their settings.
   */
  @Column({ name: 'stack', type: 'jsonb', default: () => "'[]'::jsonb" })
  stack!: string[];

  @Column({ name: 'stack_fingerprint', type: 'varchar', length: 64, nullable: true })
  stackFingerprint?: string | null;

  @Column({ name: 'stack_is_private', type: 'boolean', default: false })
  stackIsPrivate!: boolean;

  /**
   * What each dictionary in the stack is CALLED, keyed by slug.
   *
   * Stored rather than derived because only Shirabe knows: a reader's own
   * uploads are filed under content hashes (`yomitan-c89af12122021a8a`), so the
   * settings page printing the stack back to them was printing a list of hashes.
   * A static map on our side could never name those, and would go out of date
   * for the ones it could.
   */
  @Column({ name: 'stack_names', type: 'jsonb', default: () => "'{}'::jsonb" })
  stackNames!: Record<string, string>;

  /** When we last re-read the stack from Shirabe. */
  @Column({ name: 'synced_at', type: 'timestamptz', nullable: true })
  syncedAt?: Date | null;

  /**
   * When Shirabe last refused this key outright, or null while the link works.
   *
   * A link can end at the other end -- the reader revokes it from their Shirabe
   * access list, or ninety days pass without a renewal -- and nothing here would know.
   * The row went on looking healthy, the settings page went on saying "Linked
   * as ...", and every lookup went on spending a doomed round trip before
   * quietly falling back to the default dictionaries. The reader lost their own
   * dictionaries and was never told.
   *
   * Set only when Shirabe refuses to RENEW (`invalid_grant`), or answers 401
   * to a token we have just renewed: the grant is over. A 403 is a scope narrowed and lands
   * on `needsUpgrade` instead; a 429 or an outage is not an answer about the
   * key at all and must leave this alone, or Shirabe having a bad minute would
   * unlink everybody.
   *
   * The ciphertexts deliberately STAY. They are encrypted, and `unlink` still
   * wants the plaintext to hand back to Shirabe -- a revoke that is a no-op
   * against an already-dead grant is better than never trying. Marking rather
   * than deleting the row is also what lets the card say the link expired,
   * where a deleted one could only say "not connected" and leave the reader
   * wondering what they did.
   */
  @Column({ name: 'disconnected_at', type: 'timestamptz', nullable: true })
  disconnectedAt?: Date | null;

  @OneToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  /**
   * What the reader is shown about their own link. Never the token, and this is
   * the only shape that leaves the backend on a session-authenticated route.
   */
  toJSON(missingScopes: string[] = []) {
    return {
      // What the reader is asked to DO about this link. `needsUpgrade` means the
      // link works but a newer feature wants a permission granted before that
      // feature existed -- which is a re-consent, not a repair, and must never
      // read as "your connection is broken": the dictionaries it was linked for
      // keep working the whole time.
      needsUpgrade: missingScopes.length > 0,
      missingScopes,
      /** The repair `needsUpgrade` is careful not to claim: Shirabe refused this
       *  key, so the link is over until the reader makes a new one. */
      disconnected: this.disconnectedAt != null,
      // ISO strings rather than Dates: the published shape says `date-time`, and
      // a Date only becomes one by accident of whatever serializes it last.
      linkedAt: this.createdAt.toISOString(),
      shirabeName: this.shirabeName ?? null,
      scopes: this.scopes,
      dictionaries: this.stack,
      /** Slug => display name, for the stack above. Absent for a link made
       *  before Shirabe published the names, so a client falls back to the slug. */
      dictionaryNames: this.stackNames ?? {},
      stackIsPrivate: this.stackIsPrivate,
      syncedAt: this.syncedAt?.toISOString() ?? null,
    };
  }
}
