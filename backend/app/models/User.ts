import { Entity, PrimaryColumn, Column, OneToMany, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
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

  @Column({ name: 'monthly_quota_limit', type: 'int', default: 5000 })
  monthlyQuotaLimit!: number;

  @Column({ type: 'jsonb', default: '{}' })
  preferences!: UserPreferences;

  // Relations
  @OneToMany('AccountQuotaUsage', 'user')
  accountQuotaUsages?: AccountQuotaUsage[];
}
