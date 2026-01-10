import { Entity, PrimaryColumn, Column, ManyToOne, OneToMany, JoinColumn, DeleteDateColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('Episode')
export class Episode extends BaseEntity {
  @PrimaryColumn({ name: 'media_id', type: 'int' })
  mediaId!: number;

  @PrimaryColumn({ name: 'episode_number', type: 'int' })
  episodeNumber!: number;

  @Index({ unique: true, where: '"anilist_episode_id" IS NOT NULL' })
  @Column({ name: 'anilist_episode_id', type: 'int', nullable: true })
  anilistEpisodeId?: number;

  @ManyToOne('Media', 'episodes')
  @JoinColumn({ name: 'media_id' })
  media!: any;

  @Column({ name: 'title_english', type: 'text', nullable: true })
  titleEnglish?: string;

  @Column({ name: 'title_romaji', type: 'text', nullable: true })
  titleRomaji?: string;

  @Column({ name: 'title_japanese', type: 'text', nullable: true })
  titleJapanese?: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'aired_at', type: 'timestamp with time zone', nullable: true })
  airedAt?: Date;

  @Column({ name: 'length_seconds', type: 'int', nullable: true })
  lengthSeconds?: number;

  @Column({ name: 'thumbnail_url', type: 'text', nullable: true })
  thumbnailUrl?: string;

  @Column({ name: 'num_segments', type: 'int', default: 0 })
  numSegments!: number;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;

  @OneToMany('Segment', 'episodeRelation')
  segments!: any[];
}
