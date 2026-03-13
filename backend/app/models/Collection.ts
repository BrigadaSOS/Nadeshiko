import { Entity, PrimaryColumn, Column, OneToMany, ManyToOne, JoinColumn, Index, BeforeInsert } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { User } from './User';
import type { CollectionSegment } from './CollectionSegment';
import { nanoid } from 'nanoid';

export enum CollectionType {
  USER = 'USER',
  ANKI_EXPORT = 'ANKI_EXPORT',
}

export enum CollectionVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

@Entity('Collection')
export class Collection extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'public_id', type: 'varchar', unique: true })
  publicId!: string;

  @BeforeInsert()
  generatePublicId() {
    if (!this.publicId) {
      this.publicId = nanoid(12);
    }
  }

  @Column({ type: 'varchar' })
  name!: string;

  @Column({
    name: 'collection_type',
    type: 'enum',
    enum: CollectionType,
    default: CollectionType.USER,
  })
  type!: CollectionType;

  @Index()
  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Index()
  @Column({
    type: 'enum',
    enum: CollectionVisibility,
    default: CollectionVisibility.PRIVATE,
  })
  visibility!: CollectionVisibility;

  @ManyToOne('User')
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @OneToMany('CollectionSegment', 'collection')
  segmentItems!: CollectionSegment[];
}
