import { Entity, Column, ManyToOne, JoinColumn, PrimaryColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { Media } from './Media';

export enum ExternalSourceType {
  ANILIST = 'ANILIST',
  IMDB = 'IMDB',
  TVDB = 'TVDB',
  TMDB = 'TMDB',
}

@Entity('MediaExternalId')
export class MediaExternalId extends BaseEntity {
  @PrimaryColumn({ name: 'media_id', type: 'int' })
  mediaId!: number;

  @PrimaryColumn({ type: 'enum', enum: ExternalSourceType })
  source!: ExternalSourceType;

  @Column({ name: 'external_id', type: 'varchar' })
  externalId!: string;

  @ManyToOne('Media', 'externalIds', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'media_id' })
  media!: Media;
}
