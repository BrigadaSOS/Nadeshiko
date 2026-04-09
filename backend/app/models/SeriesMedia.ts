import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { Series } from './Series';
import type { Media } from './Media';

@Entity('SeriesMedia')
@Index(['seriesId', 'mediaId'], { unique: true })
@Index(['seriesId', 'position'], { unique: true })
export class SeriesMedia extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'series_id', type: 'int' })
  seriesId!: number;

  @Column({ name: 'media_id', type: 'int' })
  mediaId!: number;

  @Column({ type: 'int' })
  position!: number;

  @ManyToOne('Series', 'mediaEntries', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'series_id' })
  series!: Series;

  @ManyToOne('Media', 'seriesEntries', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'media_id' })
  media!: Media;
}
