import { Entity, PrimaryColumn, Column, Index, ManyToOne, JoinColumn, BeforeInsert } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Episode } from './Episode';
import { nanoid } from 'nanoid';

/** One morphological token, as stored and as served.
 *
 * The ten short names are the published contract: they are in our OpenAPI, in
 * the npm and PyPI SDKs, and in third-party Anki note types, so they do not
 * change. What changed is who fills them. Shirabe parses the corpus now, and
 * groups more coarsely than the old SudachiPy pipeline did: 食べました arrives as
 * ONE token reading タベマシタ where it used to arrive as three. That is the
 * point (it is a word a reader looks up, and it makes furigana come out right),
 * but it means `parts` is what you reach for when you need the finer pieces.
 */
export interface SlimToken {
  s: string;
  d: string;
  r: string;
  b: number;
  e: number;
  /** Raw UniDic primary tag (動詞). What the dictionary lookup resolves against;
   *  `posLabel` is the printable one. The four finer UniDic slots that used to
   *  sit here (p1/p2/p4/cf, named after array indices, with no p3) are gone --
   *  nothing read them, and `posLabel` says what they were kept to say. */
  p: string;
  /** word | compound | inflected | counter | function | expression | symbol. */
  kind?: string;
  /** The part of speech as a reader would say it ("Verb", "Noun"), where `p` carries the
   *  raw UniDic tag. Absent when the parser offers no label. */
  posLabel?: string;
  /** The finer morphemes inside a grouped token, each positioned like its
   *  parent. Elasticsearch highlights against its OWN analyzer, so a match can
   *  land inside one of our tokens: these are the boundaries that let a partial
   *  highlight render. Absent when the token is already atomic. */
  parts?: TokenPart[];
  /** Ruby, aligned to this surface: 食べました is 食(た) + べました, over the kanji
   *  and not the okurigana. Absent when there is none to show. */
  f?: Array<{ t: string; r?: string }>;
  /** What this surface does to its dictionary form, outermost step first:
   *  食べました is ["past", "polite"]. Japanese stacks, so it is a chain rather
   *  than one name, and an ambiguous step says so ("potential / passive")
   *  instead of picking a side. Absent for anything not an inflected word. */
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

  // Shirabe's analysis: a SlimToken[] in the field names we publish, already
  // grouped the way a reader looks words up. The only tokenization we store:
  // this replaced the SudachiPy `pos_analysis` bag, which is gone. Null until
  // the reparse reaches a row, which is an ordinary state during a 1.5M-row pass
  // and renders as plain highlight HTML rather than as an error.
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
