import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { List } from './List';

@Entity('ListSegmentItem')
@Index(['listId', 'segmentUuid'], { unique: true })
@Index(['listId', 'position'])
export class ListSegmentItem extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'list_id', type: 'int' })
  listId!: number;

  @Column({ name: 'segment_uuid', type: 'varchar' })
  segmentUuid!: string;

  @Column({ name: 'media_id', type: 'int' })
  mediaId!: number;

  @Column({ type: 'int' })
  position!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @ManyToOne('List', 'segmentItems', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'list_id' })
  list!: List;
}
