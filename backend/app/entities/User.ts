import { Entity, PrimaryColumn, Column, OneToOne, OneToMany, Index, CreateDateColumn, BaseEntity } from 'typeorm';
import { UserRole } from './UserRole';

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'modified_at', type: 'timestamp', nullable: true })
  modifiedAt?: Date;

  @Column({ name: 'last_login', type: 'timestamp', nullable: true })
  lastLogin?: Date;

  @Column({ name: 'is_verified', type: 'boolean', default: false })
  isVerified!: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive!: boolean;

  @Column({ name: 'monthly_quota_limit', type: 'bigint', default: 2500 })
  monthlyQuotaLimit!: string;

  // Relations
  @OneToOne('ApiAuth', 'user')
  apiAuth?: any;

  @OneToMany(() => UserRole, (userRole) => userRole.user, { cascade: true })
  userRoles!: UserRole[];

  @OneToMany('AccountQuotaUsage', 'user')
  accountQuotaUsages?: any[];
}
