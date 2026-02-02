import { Entity, PrimaryColumn, Column, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('Seiyuu')
export class Seiyuu extends BaseEntity {
  @PrimaryColumn({ type: 'int' })
  id!: number;

  @Column({ name: 'name_japanese', type: 'varchar' })
  nameJapanese!: string;

  @Column({ name: 'name_english', type: 'varchar' })
  nameEnglish!: string;

  @Column({ name: 'image_url', type: 'varchar' })
  imageUrl!: string;

  @OneToMany('Character', 'seiyuu')
  characters!: any[];
}
