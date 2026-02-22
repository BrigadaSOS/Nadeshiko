import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ApiPermission } from './ApiPermission';
import type { ApiAuth } from './ApiAuth';

@Entity('ApiAuthPermission')
export class ApiAuthPermission extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'api_auth_id', type: 'int' })
  apiAuthId!: number;

  @Column({
    name: 'api_permission',
    type: 'enum',
    enum: ApiPermission,
  })
  apiPermission!: ApiPermission;

  @ManyToOne('ApiAuth')
  @JoinColumn({ name: 'api_auth_id' })
  apiAuth!: ApiAuth;
}
