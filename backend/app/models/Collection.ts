import { Entity, PrimaryColumn, Column, OneToMany, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { User } from './User';
import type { CollectionSegment } from './CollectionSegment';

export enum CollectionVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

@Entity('Collection')
export class Collection extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ type: 'varchar' })
  name!: string;

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
