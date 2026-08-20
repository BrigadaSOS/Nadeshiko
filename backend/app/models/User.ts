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

interface HiddenMediaItem {
  mediaPublicId: string;
  nameEn?: string;
  nameJa?: string;
  nameRomaji?: string;
}

interface FavoriteMediaItem {
  mediaPublicId: string;
  nameEn?: string;
  nameJa?: string;
  nameRomaji?: string;
  /** Set by the server, unlike `HiddenMediaItem`'s client-invented `hiddenAt`. */
  favoritedAt: string;
}

export interface UserPreferences {
  /** Dictionary translation languages, in the order a reader wants to see them. */
  translationLanguages?: Array<'EN' | 'ES'>;
  searchHistory?: { enabled: boolean };
  /**
   * Governs the monthly per-title tally behind familiar-media sorting. Separate
   * from `searchHistory` on purpose: that one governs the activity log, this one
   * an aggregate count, and a reader may want one without the other.
   */
  familiarMedia?: { enabled: boolean };
  /**
   * Whether we may send this account the lifecycle mail -- the day-7 note, the
   * feedback ask, the monthly recap. Absent means yes: these are service
   * messages under the privacy policy's "updates or informative communications
   * related to the functionalities and services you use", so the default is on
   * and the reader turns it off.
   *
   * NOT a gate on transactional mail. A magic link, an address verification and
   * a bounce are the account working, not news about it, and honouring this flag
   * for them would let somebody lock themselves out of sign-in by clicking
   * unsubscribe in a recap.
   */
  productEmails?: { enabled: boolean };
  ankiProfiles?: AnkiProfile[];
  hiddenMedia?: HiddenMediaItem[];
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

  /**
   * The quota level this account sits on. Resolved through `resolveQuotaLimit`
   * rather than read directly -- a null tier (or one pointing at a row that has
   * since been deleted) has to fall back rather than fail a request.
   */
  @Column({ name: 'tier_id', type: 'text', nullable: true, default: 'free' })
  tierId!: string | null;

  /**
   * Per-account escape hatch, above whatever the tier says. Set for the case a
   * tier does not describe -- a one-off grant, a partner, an account being
   * unblocked mid-month -- and left null otherwise.
   */
  @Column({ name: 'quota_override', type: 'int', nullable: true })
  quotaOverride!: number | null;

  /**
   * @deprecated Read `resolveQuotaLimit(user)` instead, which applies the
   * override-then-tier order. Kept as a column because 614 rows carry the value
   * that was in force before tiers existed, and dropping it would rewrite their
   * limits in a migration rather than on a decision.
   */
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
