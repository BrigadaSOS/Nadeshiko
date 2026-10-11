import { Entity, PrimaryColumn, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Report } from './Report';
import { Segment } from './Segment';
import { User } from './User';

/** Record the actor separately from billed `userId`; the moderation service key belongs to a real user row. */
export enum RevisionActor {
  HUMAN = 'HUMAN',
  AGENT = 'AGENT',
}

@Entity('SegmentRevision')
@Index(['actor', 'createdAt'])
@Index(['reportId'])
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

  @Column({ type: 'enum', enum: RevisionActor, default: RevisionActor.HUMAN })
  actor!: RevisionActor;

  /** Keep report linkage nullable with `ON DELETE SET NULL`; deleting a report must not delete the edit it
   * motivated. */
  @Column({ name: 'report_id', type: 'int', nullable: true })
  reportId!: number | null;

  @ManyToOne(() => Segment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'segment_id' })
  segment!: Segment;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user!: User | null;

  @ManyToOne(() => Report, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'report_id' })
  report!: Report | null;
}
