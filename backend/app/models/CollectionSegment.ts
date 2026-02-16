import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { Collection } from './Collection';

@Entity('CollectionSegment')
@Index(['collectionId', 'segmentUuid'], { unique: true })
@Index(['collectionId', 'position'])
export class CollectionSegment extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'collection_id', type: 'int' })
  collectionId!: number;

  @Column({ name: 'segment_uuid', type: 'varchar' })
  segmentUuid!: string;

  @Column({ name: 'media_id', type: 'int' })
  mediaId!: number;

  @Column({ type: 'int' })
  position!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @ManyToOne('Collection', 'segmentItems', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'collection_id' })
  collection!: Collection;
}
