import { Entity, PrimaryColumn, Column, OneToMany, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Seiyuu } from './Seiyuu';

@Entity('Character')
export class Character extends BaseEntity {
  @PrimaryColumn({ type: 'int' })
  id!: number;

  @Column({ name: 'name_japanese', type: 'varchar' })
  nameJapanese!: string;

  @Column({ name: 'name_english', type: 'varchar' })
  nameEnglish!: string;

  @Column({ name: 'image_url', type: 'varchar' })
  imageUrl!: string;

  @ManyToOne('Seiyuu', 'characters', { cascade: true })
  @JoinColumn({ name: 'seiyuu_id' })
  seiyuu!: Seiyuu;

  @OneToMany('MediaCharacter', 'character')
  mediaAppearances!: any[];
}
