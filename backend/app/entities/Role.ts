import { Entity, PrimaryColumn, Column, OneToMany, BaseEntity } from 'typeorm';

export const DEFAULT_QUOTA_LIMIT = 2500;

@Entity('Role')
export class Role extends BaseEntity {
  @PrimaryColumn({ type: 'int' })
  id!: number;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  description?: string;

  @Column({ name: 'quota_limit', type: 'int', default: DEFAULT_QUOTA_LIMIT })
  quotaLimit!: number;

  @OneToMany('UserRole', 'role')
  userRoles!: any[];
}
