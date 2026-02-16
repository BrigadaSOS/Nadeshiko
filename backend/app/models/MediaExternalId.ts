import { Entity, Column, ManyToOne, JoinColumn, PrimaryColumn, CreateDateColumn } from 'typeorm';
import type { Media } from './Media';

export enum ExternalSourceType {
  ANILIST = 'ANILIST',
  IMDB = 'IMDB',
  TVDB = 'TVDB',
}

@Entity('MediaExternalId')
export class MediaExternalId {
  @PrimaryColumn({ name: 'media_id', type: 'int' })
  mediaId!: number;

  @PrimaryColumn({ type: 'enum', enum: ExternalSourceType })
  source!: ExternalSourceType;

  @Column({ name: 'external_id', type: 'varchar' })
  externalId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @ManyToOne('Media', 'externalIds', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'media_id' })
  media!: Media;
}
