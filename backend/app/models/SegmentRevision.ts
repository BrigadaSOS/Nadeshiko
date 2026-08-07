import { Entity, PrimaryColumn, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Report } from './Report';
import { Segment } from './Segment';
import { User } from './User';

/**
 * Who made an edit, as opposed to which account it was billed to.
 *
 * `userId` alone cannot answer this: the moderation agent authenticates with a
 * service API key that belongs to a real user row, so its edits are
 * indistinguishable from that user signing in and editing by hand. The
 * distinction matters for the daily digest and for spot-checking, both of which
 * want "everything the agent did" and neither of which wants human edits mixed
 * in — so it is recorded at write time rather than inferred later from the key
 * that happened to be current.
 */
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

  /**
   * The report this edit was made in response to, when there was one.
   *
   * Null for edits that came from somewhere else — an admin fixing a line they
   * noticed, an ingestion correction. `ON DELETE SET NULL` because deleting a
   * report must not take the record of what was changed because of it; the edit
   * outlives its trigger.
   */
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
