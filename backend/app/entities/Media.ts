import { Entity, PrimaryColumn, Column, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum CategoryType {
  ANIME = 'ANIME',
  BOOK = 'BOOK',
  JDRAMA = 'JDRAMA',
  AUDIOBOOK = 'AUDIOBOOK',
}

@Entity('Media')
export class Media extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'anilist_id', type: 'int' })
  anilistId!: number;

  @Column({ name: 'japanese_name', type: 'varchar' })
  japaneseName!: string;

  @Column({ name: 'romaji_name', type: 'varchar' })
  romajiName!: string;

  @Column({ name: 'english_name', type: 'varchar' })
  englishName!: string;

  @Column({ name: 'airing_format', type: 'varchar' })
  airingFormat!: string;

  @Column({ name: 'airing_status', type: 'varchar' })
  airingStatus!: string;

  @Column({ type: 'text', array: true })
  genres!: string[];

  @Column({ name: 'cover_url', type: 'varchar' })
  coverUrl!: string;

  @Column({ name: 'banner_url', type: 'varchar' })
  bannerUrl!: string;

  @Column({ name: 'release_date', type: 'varchar' })
  releaseDate!: string;

  @Column({
    type: 'enum',
    enum: CategoryType,
    default: CategoryType.ANIME,
  })
  category!: CategoryType;

  @Column({ name: 'num_segments', type: 'int', default: 0 })
  numSegments!: number;

  @Column({ name: 'num_episodes', type: 'int', default: 0 })
  numEpisodes!: number;

  @Column({ type: 'varchar' })
  version!: string;

  @OneToMany('Segment', 'media')
  segments!: any[];
}
