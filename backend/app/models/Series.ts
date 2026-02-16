import { Entity, PrimaryColumn, Column, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { SeriesMedia } from './SeriesMedia';

@Entity('Series')
export class Series extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'name_japanese', type: 'varchar' })
  nameJa!: string;

  @Column({ name: 'name_romaji', type: 'varchar' })
  nameRomaji!: string;

  @Column({ name: 'name_english', type: 'varchar' })
  nameEn!: string;

  @OneToMany('SeriesMedia', 'series')
  mediaEntries!: SeriesMedia[];
}
