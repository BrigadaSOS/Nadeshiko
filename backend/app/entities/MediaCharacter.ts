import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Character } from './Character';

export enum CharacterRole {
  MAIN = 'MAIN',
  SUPPORTING = 'SUPPORTING',
  BACKGROUND = 'BACKGROUND',
}

@Entity('MediaCharacter')
@Index(['mediaId', 'characterId'], { unique: true })
export class MediaCharacter extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'media_id', type: 'int' })
  mediaId!: number;

  @Column({ name: 'character_id', type: 'int' })
  characterId!: number;

  @Column({
    type: 'enum',
    enum: CharacterRole,
  })
  role!: CharacterRole;

  @ManyToOne('Media', 'characters', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'media_id' })
  media!: any;

  @ManyToOne('Character', 'mediaAppearances', { cascade: true })
  @JoinColumn({ name: 'character_id' })
  character!: Character;
}
