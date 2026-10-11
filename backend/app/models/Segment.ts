import { Entity, PrimaryColumn, Column, Index, ManyToOne, JoinColumn, BeforeInsert } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Episode } from './Episode';
import { nanoid } from 'nanoid';

/** Keep compact token keys stable across OpenAPI, SDKs, and Anki; grouped Shirabe tokens use `parts` for finer
 * pieces. */
export interface SlimToken {
  s: string;
  d: string;
  r: string;
  b: number;
  e: number;
  /** Store the raw UniDic primary tag for dictionary lookup; `posLabel` is the printable form. */
  p: string;
  /** word | compound | inflected | counter | function | expression | symbol. */
  kind?: string;
  /** The part of speech as a reader would say it ("Verb", "Noun"), where `p` carries the
   *  raw UniDic tag. Absent when the parser offers no label. */
  posLabel?: string;
  /** Store Shirabe’s short POS vocabulary for word-identification ranking; older rows fall back from `p` until
   * reparsed. */
  pt?: string;
  /** Store inner morpheme offsets so Elasticsearch matches inside grouped tokens can render partial highlights. */
  parts?: TokenPart[];
  /** Ruby, aligned to this surface: 食べました is 食(た) + べました, over the kanji
   *  and not the okurigana. Absent when there is none to show. */
  f?: Array<{ t: string; r?: string }>;
  /** Store inflection steps outermost-first; Japanese may have a chain or an explicitly ambiguous step. */
  inflection?: { labels: string[]; base: string };
}

export interface TokenPart {
  s: string;
  b: number;
  e: number;
}

export enum SegmentStatus {
  ACTIVE = 'ACTIVE',
  HIDDEN = 'HIDDEN',
  DELETED = 'DELETED',
  // Legacy values kept for DB enum compatibility — not used by application
  /** @deprecated Use HIDDEN instead */
  SUSPENDED = 'SUSPENDED',
  /** @deprecated Use HIDDEN instead */
  VERIFIED = 'VERIFIED',
  /** @deprecated Use HIDDEN instead */
  INVALID = 'INVALID',
  /** @deprecated Use HIDDEN instead */
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

  // Store Shirabe’s published token shape; null means not yet reparsed and renders as plain highlight HTML.
  @Column({ name: 'tokens', type: 'jsonb', nullable: true })
  tokens!: SlimToken[] | null;

  @Column({ name: 'storage', type: 'enum', enum: SegmentStorage, default: SegmentStorage.R2 })
  storage!: SegmentStorage;

  @Column({ name: 'hashed_id', type: 'varchar' })
  hashedId!: string;

  @Column({ type: 'smallint' })
  episode!: number;

  @Column({ name: 'external_video_id', type: 'varchar', nullable: true })
  externalVideoId?: string | null;

  @Column({ name: 'media_id', type: 'int' })
  mediaId!: number;

  @Column({ name: 'storage_base_path', type: 'varchar' })
  storageBasePath!: string;

  @ManyToOne('Episode', 'segments', { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'media_id', referencedColumnName: 'mediaId' },
    { name: 'episode', referencedColumnName: 'episodeNumber' },
  ])
  episodeRelation!: Episode;
}
