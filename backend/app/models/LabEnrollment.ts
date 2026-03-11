import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, Index, CreateDateColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { User } from './User';

@Entity('LabEnrollment')
@Index(['userId', 'labKey'], { unique: true })
export class LabEnrollment extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ name: 'lab_key', type: 'varchar' })
  labKey!: string;

  @CreateDateColumn({ name: 'enrolled_at' })
  enrolledAt!: Date;

  @ManyToOne('User', 'labEnrollments', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
