import { Entity, PrimaryColumn, Column, OneToOne, OneToMany, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { ApiAuth } from './ApiAuth';
import type { AccountQuotaUsage } from './AccountQuotaUsage';
import type { LabEnrollment } from './LabEnrollment';

export enum UserRoleType {
  ADMIN = 'ADMIN',
  MOD = 'MOD',
  USER = 'USER',
  PATREON = 'PATREON',
}

export interface AnkiProfile {
  id: string;
  name: string;
  deck?: string | null;
  model?: string | null;
  fields?: { key: string; value: string }[];
  key?: string | null;
  serverAddress: string;
}

export interface HiddenMediaItem {
  mediaId: number;
  nameEn?: string;
  nameJa?: string;
  nameRomaji?: string;
}

export interface UserPreferences {
  searchHistory?: { enabled: boolean };
  blogLastVisited?: string;
  ankiProfiles?: AnkiProfile[];
  hiddenMedia?: HiddenMediaItem[];
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

  @Column({ name: 'last_login', type: 'timestamp', nullable: true })
  lastLogin?: Date;

  @Column({ name: 'is_verified', type: 'boolean', default: false })
  isVerified!: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive!: boolean;

  @Column({ name: 'role', type: 'enum', enum: UserRoleType, default: UserRoleType.USER })
  role!: UserRoleType;

  @Column({ name: 'monthly_quota_limit', type: 'int', default: 2500 })
  monthlyQuotaLimit!: number;

  @Column({ type: 'jsonb', default: '{}' })
  preferences!: UserPreferences;

  // Relations
  @OneToOne('ApiAuth', 'user')
  apiAuth?: ApiAuth;

  @OneToMany('AccountQuotaUsage', 'user')
  accountQuotaUsages?: AccountQuotaUsage[];

  @OneToMany('LabEnrollment', 'user')
  labEnrollments?: LabEnrollment[];
}
