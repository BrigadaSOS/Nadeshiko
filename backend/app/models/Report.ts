import { Entity, PrimaryColumn, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { User } from './User';

export enum ReportType {
  SEGMENT = 'SEGMENT',
  MEDIA = 'MEDIA',
}

export enum ReportStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  RESOLVED = 'RESOLVED',
}

export enum ReportReason {
  // Segment reasons
  WRONG_TRANSLATION = 'WRONG_TRANSLATION',
  WRONG_TIMING = 'WRONG_TIMING',
  WRONG_AUDIO = 'WRONG_AUDIO',
  NSFW_NOT_TAGGED = 'NSFW_NOT_TAGGED',
  DUPLICATE_SEGMENT = 'DUPLICATE_SEGMENT',
  // Media reasons
  WRONG_METADATA = 'WRONG_METADATA',
  MISSING_EPISODES = 'MISSING_EPISODES',
  WRONG_COVER_IMAGE = 'WRONG_COVER_IMAGE',
  // Shared reasons
  INAPPROPRIATE_CONTENT = 'INAPPROPRIATE_CONTENT',
  OTHER = 'OTHER',
}

@Entity('Report')
@Index(['reportType', 'targetId'])
@Index(['userId'])
@Index(['status'])
export class Report extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'report_type', type: 'enum', enum: ReportType })
  reportType!: ReportType;

  @Column({ name: 'target_id', type: 'varchar' })
  targetId!: string;

  @Column({ type: 'enum', enum: ReportReason })
  reason!: ReportReason;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description?: string | null;

  @Column({ type: 'enum', enum: ReportStatus, default: ReportStatus.PENDING })
  status!: ReportStatus;

  @Column({ name: 'admin_notes', type: 'varchar', length: 1000, nullable: true })
  adminNotes?: string | null;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt?: Date | null;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ name: 'resolved_by_id', type: 'int', nullable: true })
  resolvedById?: number | null;

  @ManyToOne('User')
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @ManyToOne('User')
  @JoinColumn({ name: 'resolved_by_id' })
  resolvedBy?: User | null;
}
