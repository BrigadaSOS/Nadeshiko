import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { Character } from './Character';

@Entity('Seiyuu')
export class Seiyuu extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'external_ids', type: 'jsonb', default: {} })
  externalIds!: Record<string, string>;

  @Column({ name: 'name_japanese', type: 'varchar' })
  nameJapanese!: string;

  @Column({ name: 'name_english', type: 'varchar' })
  nameEnglish!: string;

  @Column({ name: 'image_url', type: 'varchar' })
  imageUrl!: string;

  @OneToMany('Character', 'seiyuu')
  characters!: Character[];
}
