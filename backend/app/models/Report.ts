import { Entity, PrimaryColumn, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { User } from './User';

export enum ReportSource {
  USER = 'USER',
  AUTO = 'AUTO',
}

export enum ReportTargetType {
  SEGMENT = 'SEGMENT',
  EPISODE = 'EPISODE',
  MEDIA = 'MEDIA',
}

export enum ReportStatus {
  OPEN = 'OPEN',
  PROCESSING = 'PROCESSING',
  FIXED = 'FIXED',
  DISMISSED = 'DISMISSED',
}

export enum ReportReason {
  // Segment reasons (USER)
  WRONG_TRANSLATION = 'WRONG_TRANSLATION',
  WRONG_TIMING = 'WRONG_TIMING',
  WRONG_AUDIO = 'WRONG_AUDIO',
  WRONG_JAPANESE_TEXT = 'WRONG_JAPANESE_TEXT',
  LOW_QUALITY_AUDIO = 'LOW_QUALITY_AUDIO',
  NSFW_NOT_TAGGED = 'NSFW_NOT_TAGGED',
  DUPLICATE_SEGMENT = 'DUPLICATE_SEGMENT',
  // Media reasons (USER)
  WRONG_METADATA = 'WRONG_METADATA',
  MISSING_EPISODES = 'MISSING_EPISODES',
  WRONG_COVER_IMAGE = 'WRONG_COVER_IMAGE',
  WRONG_TITLE = 'WRONG_TITLE',
  DUPLICATE_MEDIA = 'DUPLICATE_MEDIA',
  WRONG_EPISODE_NUMBER = 'WRONG_EPISODE_NUMBER',
  IMAGE_ISSUE = 'IMAGE_ISSUE',
  // Shared reasons
  INAPPROPRIATE_CONTENT = 'INAPPROPRIATE_CONTENT',
  OTHER = 'OTHER',
  // Auto-check reason codes
  LOW_SEGMENT_MEDIA = 'LOW_SEGMENT_MEDIA',
  EMPTY_EPISODES = 'EMPTY_EPISODES',
  MISSING_EPISODES_AUTO = 'MISSING_EPISODES_AUTO',
  BAD_SEGMENT_RATIO = 'BAD_SEGMENT_RATIO',
  MEDIA_WITH_NO_EPISODES = 'MEDIA_WITH_NO_EPISODES',
  MISSING_TRANSLATIONS = 'MISSING_TRANSLATIONS',
  DB_ES_SYNC_ISSUES = 'DB_ES_SYNC_ISSUES',
  HIGH_REPORT_DENSITY = 'HIGH_REPORT_DENSITY',
}

@Entity('Report')
@Index(['source'])
@Index(['targetType', 'targetMediaId'])
@Index(['auditRunId'])
@Index(['status'])
@Index(['userId'])
export class Report extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ type: 'enum', enum: ReportSource })
  source!: ReportSource;

  @Column({ name: 'target_type', type: 'enum', enum: ReportTargetType })
  targetType!: ReportTargetType;

  @Column({ name: 'target_media_id', type: 'int' })
  targetMediaId!: number;

  @Column({ name: 'target_episode_number', type: 'int', nullable: true })
  targetEpisodeNumber?: number | null;

  @Column({ name: 'target_segment_id', type: 'int', nullable: true })
  targetSegmentId?: number | null;

  @Column({ name: 'audit_run_id', type: 'int', nullable: true })
  auditRunId?: number | null;

  @Column({ type: 'enum', enum: ReportReason })
  reason!: ReportReason;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  data?: Record<string, unknown> | null;

  @Column({ type: 'enum', enum: ReportStatus, default: ReportStatus.OPEN })
  status!: ReportStatus;

  @Column({ name: 'admin_notes', type: 'varchar', length: 1000, nullable: true })
  adminNotes?: string | null;

  @Column({ name: 'user_id', type: 'int', nullable: true })
  userId?: number | null;

  @ManyToOne('User', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user?: User | null;

  @ManyToOne('MediaAuditRun', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'audit_run_id' })
  auditRun?: unknown;
}
