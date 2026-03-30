import { Entity, PrimaryColumn, Column, Index, ManyToOne, JoinColumn, BeforeInsert } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Episode } from './Episode';
import { nanoid } from 'nanoid';
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

// Typed as `object` to avoid TypeORM's _QueryDeepPartialEntity recursion issue with JSONB columns.
// Actual shape: { sudachi?: Array<{surface, dictionary_form, reading, begin, end, pos}>, unidic?: Array<...>, _tokenizer_*: string }
export type PosAnalysisData = object;

export enum SegmentStorage {
  LOCAL = 'LOCAL',
  R2 = 'R2',
}

@Entity('Segment')
@Index(['uuid'], { unique: true })
@Index(['publicId'], { unique: true })
export class Segment extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ type: 'varchar', unique: true })
  uuid!: string;

  @Column({ name: 'public_id', type: 'varchar', unique: true })
  publicId!: string;

  @BeforeInsert()
  generatePublicId() {
    this.publicId = nanoid(12);
  }

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

  @Column({ name: 'content_rating', type: 'enum', enum: ContentRating })
  contentRating!: ContentRating;

  @Column({ name: 'rating_analysis', type: 'jsonb' })
  ratingAnalysis!: RatingAnalysisData;

  @Column({ name: 'pos_analysis', type: 'jsonb' })
  posAnalysis!: PosAnalysisData;

  @Column({ name: 'storage', type: 'enum', enum: SegmentStorage, default: SegmentStorage.R2 })
  storage!: SegmentStorage;

  @Column({ name: 'hashed_id', type: 'varchar' })
  hashedId!: string;

  @Column({ type: 'smallint' })
  episode!: number;

  @Column({ name: 'media_id', type: 'int' })
  mediaId!: number;

  @Column({ name: 'storage_base_path', type: 'varchar' })
  storageBasePath!: string;

  @ManyToOne('Episode', 'segments')
  @JoinColumn([
    { name: 'media_id', referencedColumnName: 'mediaId' },
    { name: 'episode', referencedColumnName: 'episodeNumber' },
  ])
  episodeRelation!: Episode;
}
