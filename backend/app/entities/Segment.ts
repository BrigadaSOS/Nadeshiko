import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum SegmentStatus {
  DELETED = 0,
  ACTIVE = 1,
  SUSPENDED = 2,
  VERIFIED = 3,
  INVALID_SENTENCE = 100,
  SENTENCE_TOO_LONG = 101,
}

@Entity('Segment')
@Index(['uuid'], { unique: true })
export class Segment extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ type: 'varchar', unique: true })
  uuid!: string;

  @Column({ type: 'int' })
  position!: number;

  @Column({
    type: 'smallint',
    enum: SegmentStatus,
    default: SegmentStatus.ACTIVE,
  })
  status!: SegmentStatus;

  @Column({ name: 'start_time', type: 'varchar' })
  startTime!: string;

  @Column({ name: 'end_time', type: 'varchar' })
  endTime!: string;

  @Column({ type: 'varchar', length: 500 })
  content!: string;

  @Column({ name: 'content_length', type: 'int' })
  contentLength!: number;

  @Column({ name: 'content_spanish', type: 'varchar', length: 500, nullable: true })
  contentSpanish?: string;

  @Column({ name: 'content_spanish_mt', type: 'boolean', default: false })
  contentSpanishMt!: boolean;

  @Column({ name: 'content_english', type: 'varchar', length: 500, nullable: true })
  contentEnglish?: string;

  @Column({ name: 'content_english_mt', type: 'boolean', default: false })
  contentEnglishMt!: boolean;

  @Column({ name: 'is_nsfw', type: 'boolean', default: false })
  isNsfw!: boolean;

  @Column({ name: 'image_url', type: 'varchar', nullable: true })
  imageUrl?: string;

  @Column({ name: 'audio_url', type: 'varchar', nullable: true })
  audioUrl?: string;

  @Column({ name: 'actor_ja', type: 'varchar', nullable: true })
  actorJa?: string;

  @Column({ name: 'actor_es', type: 'varchar', nullable: true })
  actorEs?: string;

  @Column({ name: 'actor_en', type: 'varchar', nullable: true })
  actorEn?: string;

  @Column({ type: 'smallint' })
  episode!: number;

  @Column({ name: 'media_id', type: 'int' })
  mediaId!: number;

  @ManyToOne('Media', 'segments')
  @JoinColumn({ name: 'media_id' })
  media!: any;

  @ManyToOne('Episode', 'segments')
  @JoinColumn([
    { name: 'media_id', referencedColumnName: 'mediaId' },
    { name: 'episode', referencedColumnName: 'episodeNumber' },
  ])
  episodeRelation!: any;
}
