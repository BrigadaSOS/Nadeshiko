import { Entity, PrimaryColumn, Column, ManyToOne, OneToMany, JoinColumn, CreateDateColumn, BaseEntity } from 'typeorm';
import type { User } from './User';
import type { ApiAuthPermission } from './ApiAuthPermission';

@Entity('ApiAuth')
export class ApiAuth extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ type: 'varchar', nullable: true })
  name?: string;

  @Column({ type: 'varchar', nullable: true })
  hint?: string;

  @Column({ type: 'varchar' })
  token!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'user_id', type: 'int', nullable: true })
  userId?: number;

  @ManyToOne('User', 'apiAuth')
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @OneToMany('ApiAuthPermission', 'apiAuth')
  permissions!: ApiAuthPermission[];
}
