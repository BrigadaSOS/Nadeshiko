import { Entity, PrimaryColumn, Column, Index, OneToOne, JoinColumn } from 'typeorm';
import type { User } from './User';
import { BaseEntity } from './base.entity';

/** This stored credential supplies the reader’s Shirabe dictionary stack; it is not a Better Auth account and must
 * not grant or remove Nadeshiko sign-in. */
@Entity('ShirabeConnection')
export class ShirabeConnection extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Index({ unique: true })
  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  /** Encrypt both reader tokens at rest; either can access the reader’s Shirabe data, so a dump must not expose live
   * credentials. */
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

  /** Resolved dictionary stack. Keep the fingerprint for cache identity, and never share results when the stack
   * includes a reader-owned upload. */
  @Column({ name: 'stack', type: 'jsonb', default: () => "'[]'::jsonb" })
  stack!: string[];

  @Column({ name: 'stack_fingerprint', type: 'varchar', length: 64, nullable: true })
  stackFingerprint?: string | null;

  @Column({ name: 'stack_is_private', type: 'boolean', default: false })
  stackIsPrivate!: boolean;

  /** Dictionary display names are supplied by Shirabe because reader-owned uploads are keyed by content hashes. */
  @Column({ name: 'stack_names', type: 'jsonb', default: () => "'{}'::jsonb" })
  stackNames!: Record<string, string>;

  /** When we last re-read the stack from Shirabe. */
  @Column({ name: 'synced_at', type: 'timestamptz', nullable: true })
  syncedAt?: Date | null;

  /** Timestamp a proven grant loss, or leave null while usable; only `invalid_grant`/post-renewal 401 qualify. Keep
   * tokens for revoke. */
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
      // `needsUpgrade` means re-consent for a new permission, not a broken link; the existing dictionary access still
      // works.
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
