import { Entity, PrimaryColumn, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { Episode } from './Episode';
import type { MorphemeData } from '@app/types/morpheme';

export enum SegmentStatus {
  DELETED = 'DELETED',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  VERIFIED = 'VERIFIED',
  INVALID = 'INVALID',
  TOO_LONG = 'TOO_LONG',
}

export enum SegmentStorage {
  LOCAL = 'LOCAL',
  R2 = 'R2',
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
    type: 'enum',
    enum: SegmentStatus,
    default: SegmentStatus.ACTIVE,
  })
  status!: SegmentStatus;

  @Column({ name: 'start_time', type: 'varchar' })
  startTime!: string;

  @Column({ name: 'end_time', type: 'varchar' })
  endTime!: string;

  @Column({ name: 'content', type: 'varchar', length: 500 })
  contentJa!: string;

  @Column({ name: 'content_length', type: 'int' })
  characterCount!: number;

  @Column({ name: 'content_spanish', type: 'varchar', length: 500 })
  contentEs!: string;

  @Column({ name: 'content_spanish_mt', type: 'boolean', default: false })
  contentEsMt!: boolean;

  @Column({ name: 'content_english', type: 'varchar', length: 500 })
  contentEn!: string;

  @Column({ name: 'content_english_mt', type: 'boolean', default: false })
  contentEnMt!: boolean;

  @Column({ name: 'is_nsfw', type: 'boolean', default: false })
  isNsfw!: boolean;

  @Column({ name: 'storage', type: 'enum', enum: SegmentStorage, default: SegmentStorage.R2 })
  storage!: SegmentStorage;

  @Column({ name: 'hashed_id', type: 'varchar' })
  hashedId!: string;

  @Column({ name: 'morphemes', type: 'jsonb', nullable: true })
  morphemes?: MorphemeData[] | null;

  @Column({ type: 'smallint' })
  episode!: number;

  @Column({ name: 'media_id', type: 'int' })
  mediaId!: number;

  @ManyToOne('Episode', 'segments')
  @JoinColumn([
    { name: 'media_id', referencedColumnName: 'mediaId' },
    { name: 'episode', referencedColumnName: 'episodeNumber' },
  ])
  episodeRelation!: Episode;
}
