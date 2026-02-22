import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, Index, CreateDateColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { User } from './User';

@Entity('ExperimentEnrollment')
@Index(['userId', 'experimentKey'], { unique: true })
export class ExperimentEnrollment extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ name: 'experiment_key', type: 'varchar' })
  experimentKey!: string;

  @CreateDateColumn({ name: 'enrolled_at' })
  enrolledAt!: Date;

  @ManyToOne('User', 'experimentEnrollments', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
