import { Entity, PrimaryColumn, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('Experiment')
export class Experiment extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ type: 'varchar', unique: true })
  key!: string;

  @Column({ type: 'varchar', nullable: true })
  name?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'boolean', default: false })
  enforced!: boolean;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ name: 'rollout_percentage', type: 'int', default: 0 })
  rolloutPercentage!: number;

  @Column({ name: 'allowed_user_ids', type: 'jsonb', default: '[]' })
  allowedUserIds!: number[];
}
