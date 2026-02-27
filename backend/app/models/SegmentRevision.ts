import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Segment } from './Segment';
import { User } from './User';

@Entity('SegmentRevision')
export class SegmentRevision extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'segment_id', type: 'int' })
  segmentId!: number;

  @Column({ name: 'revision_number', type: 'int' })
  revisionNumber!: number;

  @Column({ type: 'jsonb' })
  snapshot!: Record<string, unknown>;

  @Column({ name: 'user_id', type: 'int', nullable: true })
  userId!: number | null;

  @ManyToOne(() => Segment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'segment_id' })
  segment!: Segment;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user!: User | null;
}
