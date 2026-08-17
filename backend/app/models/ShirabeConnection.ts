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
   * The Shirabe API key, encrypted at rest (see lib/secretBox.ts).
   *
   * It is theirs, not ours: it can read their account and, if they ever grant
   * the scopes for it, write to their study data. A dump of this table must not
   * be a pile of live credentials for somebody else's service.
   */
  @Column({ name: 'token_ciphertext', type: 'text' })
  tokenCiphertext!: string;

  /**
   * The key's first few characters, which is what Shirabe itself shows in its
   * access list. Stored so our settings page can say WHICH key this is without
   * decrypting anything: a reader comparing the two lists needs to recognize the
   * row, not read the secret.
   */
  @Column({ name: 'token_prefix', type: 'varchar', length: 32 })
  tokenPrefix!: string;

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
      // ISO strings rather than Dates: the published shape says `date-time`, and
      // a Date only becomes one by accident of whatever serializes it last.
      linkedAt: this.createdAt.toISOString(),
      shirabeName: this.shirabeName ?? null,
      tokenPrefix: this.tokenPrefix,
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
