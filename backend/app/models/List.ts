import { Entity, PrimaryColumn, Column, OneToMany, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { User } from './User';
import type { ListItem } from './ListItem';

export enum ListType {
  SERIES = 'SERIES',
  CUSTOM = 'CUSTOM',
}

export enum ListVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

@Entity('List')
export class List extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({
    type: 'enum',
    enum: ListType,
  })
  type!: ListType;

  @Index()
  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Index()
  @Column({
    type: 'enum',
    enum: ListVisibility,
    default: ListVisibility.PRIVATE,
  })
  visibility!: ListVisibility;

  @ManyToOne('User')
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @OneToMany('ListItem', 'list')
  items!: ListItem[];
}
