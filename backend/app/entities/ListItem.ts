import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('ListItem')
@Index(['listId', 'mediaId'], { unique: true })
@Index(['listId', 'position'], { unique: true })
export class ListItem extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'list_id', type: 'int' })
  listId!: number;

  @Column({ name: 'media_id', type: 'int' })
  mediaId!: number;

  @Column({ type: 'int' })
  position!: number;

  @ManyToOne('List', 'items', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'list_id' })
  list!: any;

  @ManyToOne('Media', 'listItems')
  @JoinColumn({ name: 'media_id' })
  media!: any;
}
