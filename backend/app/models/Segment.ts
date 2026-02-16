import { Entity, PrimaryColumn, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ResponseSchemas, Internal } from '@lib/decorators';
import type { Episode } from './Episode';
export enum SegmentStatus {
  DELETED = 'DELETED',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  VERIFIED = 'VERIFIED',
  INVALID = 'INVALID',
  TOO_LONG = 'TOO_LONG',
}

export enum ContentRating {
  SAFE = 'SAFE',
  SUGGESTIVE = 'SUGGESTIVE',
  QUESTIONABLE = 'QUESTIONABLE',
  EXPLICIT = 'EXPLICIT',
}

export interface RatingAnalysisData {
  scores?: Record<string, number>;
  tags?: Record<string, number>;
}

export enum SegmentStorage {
  LOCAL = 'LOCAL',
  R2 = 'R2',
}

@Entity('Segment')
@Index(['uuid'], { unique: true })
@ResponseSchemas('Segment')
export class Segment extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ type: 'varchar', unique: true })
  uuid!: string;

  @Column({ type: 'int' })
  position!: number;

  @Column({
    type: 'enum',
    enum: SegmentStatus,
    default: SegmentStatus.ACTIVE,
  })
  status!: SegmentStatus;

  @Column({ name: 'start_time_ms', type: 'int' })
  startTimeMs!: number;

  @Column({ name: 'end_time_ms', type: 'int' })
  endTimeMs!: number;

  @Column({ name: 'content', type: 'varchar', length: 500 })
  contentJa!: string;

  @Column({ name: 'content_spanish', type: 'varchar', length: 500 })
  contentEs!: string;

  @Column({ name: 'content_spanish_mt', type: 'boolean', default: false })
  contentEsMt!: boolean;

  @Column({ name: 'content_english', type: 'varchar', length: 500 })
  contentEn!: string;

  @Column({ name: 'content_english_mt', type: 'boolean', default: false })
  contentEnMt!: boolean;

  @Column({ name: 'content_rating', type: 'enum', enum: ContentRating, default: ContentRating.SAFE })
  contentRating!: ContentRating;

  @Internal()
  @Column({ name: 'rating_analysis', type: 'jsonb', nullable: true })
  ratingAnalysis?: RatingAnalysisData | null;

  @Internal()
  @Column({ name: 'pos_analysis', type: 'jsonb', nullable: true })
  posAnalysis?: Record<string, unknown> | null;

  @Internal()
  @Column({ name: 'storage', type: 'enum', enum: SegmentStorage, default: SegmentStorage.R2 })
  storage!: SegmentStorage;

  @Internal()
  @Column({ name: 'hashed_id', type: 'varchar' })
  hashedId!: string;

  @Column({ type: 'smallint' })
  episode!: number;

  @Column({ name: 'media_id', type: 'int' })
  mediaId!: number;

  @Internal()
  @Column({ name: 'storage_base_path', type: 'varchar' })
  storageBasePath!: string;

  @ManyToOne('Episode', 'segments')
  @JoinColumn([
    { name: 'media_id', referencedColumnName: 'mediaId' },
    { name: 'episode', referencedColumnName: 'episodeNumber' },
  ])
  episodeRelation!: Episode;
}
