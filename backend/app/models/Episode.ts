import { Entity, PrimaryColumn, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { Media } from './Media';
import type { Segment } from './Segment';

@Entity('Episode')
export class Episode extends BaseEntity {
  @PrimaryColumn({ name: 'media_id', type: 'int' })
  mediaId!: number;

  @PrimaryColumn({ name: 'episode_number', type: 'int' })
  episodeNumber!: number;

  @ManyToOne('Media', 'episodes')
  @JoinColumn({ name: 'media_id' })
  media!: Media;

  @Column({ name: 'title_english', type: 'text', nullable: true })
  titleEn?: string;

  @Column({ name: 'title_romaji', type: 'text', nullable: true })
  titleRomaji?: string;

  @Column({ name: 'title_japanese', type: 'text', nullable: true })
  titleJa?: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'aired_at', type: 'timestamp with time zone', nullable: true })
  airedAt?: Date;

  @Column({ name: 'length_seconds', type: 'int', nullable: true })
  lengthSeconds?: number;

  @Column({ name: 'thumbnail_url', type: 'text', nullable: true })
  thumbnailUrl?: string;

  @Column({ name: 'num_segments', type: 'int', default: 0 })
  segmentCount!: number;

  @OneToMany('Segment', 'episodeRelation', { cascade: true })
  segments!: Segment[];
}
