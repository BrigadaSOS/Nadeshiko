import { Entity, PrimaryGeneratedColumn, Column, OneToMany, ManyToOne, JoinColumn, BeforeInsert } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Seiyuu } from './Seiyuu';
import type { MediaCharacter } from './MediaCharacter';
import { nanoid } from 'nanoid';

@Entity('Character')
export class Character extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'public_id', type: 'varchar', unique: true })
  publicId!: string;

  @BeforeInsert()
  generatePublicId() {
    this.publicId = nanoid(12);
  }

  @Column({ name: 'external_ids', type: 'jsonb', default: {} })
  externalIds!: Record<string, string>;

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
  mediaAppearances!: MediaCharacter[];
}
