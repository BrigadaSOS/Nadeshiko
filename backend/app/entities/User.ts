import { Entity, PrimaryColumn, Column, OneToOne, OneToMany, Index, CreateDateColumn, BaseEntity } from 'typeorm';
import { UserRole } from './UserRole';
import { UserAuth } from './UserAuth';
import { UserToken } from './UserToken';

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
  password?: string;

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

  // Relations
  @OneToOne('ApiAuth', 'user')
  apiAuth?: any;

  @OneToMany(() => UserRole, (userRole) => userRole.user)
  userRoles!: UserRole[];

  @OneToMany(() => UserAuth, (userAuth) => userAuth.user)
  userAuths!: UserAuth[];

  @OneToMany(() => UserToken, (token) => token.user)
  tokens!: UserToken[];
}
