import { Entity, PrimaryColumn, Column, OneToMany, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tier } from './Tier';
import type { AccountQuotaUsage } from './AccountQuotaUsage';
import type { CategoryType } from './Media';

export enum UserRoleType {
  ADMIN = 'ADMIN',
  MOD = 'MOD',
  USER = 'USER',
  PATREON = 'PATREON',
}

interface AnkiProfile {
  id: string;
  name: string;
  deck?: string | null;
  model?: string | null;
  fields?: { key: string; value: string }[];
  key?: string | null;
  serverAddress: string;
}

export interface HiddenMediaItem {
  mediaPublicId: string;
}

export interface FavoriteMediaItem {
  mediaPublicId: string;
  /** Server-set timestamp; it is the only starred-title field not derived from catalogue data. */
  favoritedAt: string;
}

export interface UserPreferences {
  /** Dictionary translation languages, in the order a reader wants to see them. */
  translationLanguages?: Array<'EN' | 'ES'>;
  searchHistory?: { enabled: boolean };
  /** Separate familiar-media tally consent from `searchHistory`: a reader may want aggregate counts without
   * retaining a search diary. */
  familiarMedia?: { enabled: boolean };
  /** Controls lifecycle mail only; absent means allowed. It must not gate transactional sign-in, verification, or
   * bounce messages. */
  productEmails?: {
    /** Master lifecycle switch; absent category consent follows this value instead of opting readers back in. */
    enabled: boolean;
    /** A missing category follows `enabled`; it is never a new opt-in, so later categories cannot re-subscribe an
     * existing opt-out. */
    /** The monthly digest of their own activity. Recurring, indefinitely. */
    recap?: boolean;
    /** Occasional one-off questions: the day-7 ask, the win-back note. */
    checkins?: boolean;
    /** Releases and new features, including any request for support that rides in one. */
    updates?: boolean;
  };
  ankiProfiles?: AnkiProfile[];
  /** Store hidden titles by id, but retain the object wrapper for old containers and browser tabs during rolling
   * deploys. */
  hiddenMedia?: HiddenMediaItem[];
  /** Same slimming as `hiddenMedia`; see `FavoriteMediaItem` for why this one kept a field. */
  favoriteMedia?: FavoriteMediaItem[];
  hiddenCategories?: CategoryType[];
  /** `ALL` (and unset) means every visible category; see `UserPreferences.yaml`. */
  defaultSearchCategory?: CategoryType | 'ALL';
}

@Entity('User')
@Index(['email'])
export class User extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ type: 'varchar' })
  username!: string;

  @Column({ type: 'varchar', unique: true })
  email!: string;

  @Column({ type: 'varchar', nullable: true })
  image?: string;

  @Column({ name: 'modified_at', type: 'timestamp', nullable: true })
  modifiedAt?: Date;

  @Column({ name: 'is_verified', type: 'boolean', default: false })
  isVerified!: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive!: boolean;

  @Column({ name: 'role', type: 'enum', enum: UserRoleType, default: UserRoleType.USER })
  role!: UserRoleType;

  // Keep Better Auth's ban fields on the application model too: API-key auth reads this model, so omission would bypass
  // a ban.
  @Column({ name: 'banned', type: 'boolean', default: false })
  banned!: boolean;

  @Column({ name: 'ban_expires', type: 'timestamptz', nullable: true })
  banExpires?: Date | null;

  /** Signup country is recorded once from Cloudflare; null means not recorded, including seeds, scripts, and local
   * development. */
  @Column({ name: 'signup_country', type: 'varchar', length: 2, nullable: true })
  signupCountry?: string | null;

  /** Last-seen is approximate: session refresh updates it only past `updateAge`; a missing country leaves the
   * previous country intact. */
  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt?: Date | null;

  @Column({ name: 'last_seen_country', type: 'varchar', length: 2, nullable: true })
  lastSeenCountry?: string | null;

  /** Resolve override/tier through `resolveQuotaLimit`; a missing tier must fall back rather than fail the request. */
  @Column({ name: 'tier_id', type: 'text', nullable: true, default: 'free' })
  tierId!: string | null;

  /** Per-account override wins over the tier; null means the account uses the tier/default path. */
  @Column({ name: 'quota_override', type: 'int', nullable: true })
  quotaOverride!: number | null;

  /** @deprecated Use `resolveQuotaLimit(user)`, which applies override then tier. Keep the legacy column so existing
   * limits are not rewritten by migration. */
  @Column({ name: 'monthly_quota_limit', type: 'int', default: 5000 })
  monthlyQuotaLimit!: number;

  @Column({ type: 'jsonb', default: '{}' })
  preferences!: UserPreferences;

  // Relations
  @OneToMany('AccountQuotaUsage', 'user')
  accountQuotaUsages?: AccountQuotaUsage[];

  @ManyToOne(() => Tier, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'tier_id' })
  tier?: Tier | null;
}
