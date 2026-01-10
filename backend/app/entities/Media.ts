import { Entity, PrimaryColumn, Column, OneToMany, DeleteDateColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Episode } from './Episode';

export enum CategoryType {
  ANIME = 'ANIME',
  BOOK = 'BOOK',
  JDRAMA = 'JDRAMA',
  AUDIOBOOK = 'AUDIOBOOK',
}

@Entity('Media')
export class Media extends BaseEntity {
  @PrimaryColumn({ type: 'int' })
  id!: number;

  @Index({ unique: true })
  @Column({ name: 'anilist_id', type: 'int', unique: true })
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

  @Column({ name: 'release_date', type: 'varchar', nullable: false })
  releaseDate!: string;

  @Column({
    type: 'enum',
    enum: CategoryType,
    default: CategoryType.ANIME,
  })
  category!: CategoryType;

  @Column({ name: 'num_segments', type: 'int', default: 0 })
  numSegments!: number;

  @Column({ type: 'varchar' })
  version!: string;

  @Column({ name: 'hash_salt', type: 'varchar', nullable: true })
  hashSalt?: string;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;

  @OneToMany('Segment', 'media')
  segments!: any[];

  @OneToMany('Episode', 'media')
  episodes!: Episode[];
}
