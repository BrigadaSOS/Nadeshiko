import { Entity, PrimaryColumn, Column, Index, CreateDateColumn, BaseEntity, ManyToOne, JoinColumn } from 'typeorm';
import type { User } from './User';

export enum ActivityType {
  SEARCH = 'SEARCH',
  ANKI_EXPORT = 'ANKI_EXPORT',
  SEGMENT_PLAY = 'SEGMENT_PLAY',
  LIST_ADD_SEGMENT = 'LIST_ADD_SEGMENT',
}

@Entity('UserActivity')
@Index(['userId', 'createdAt'])
@Index(['userId', 'activityType'])
export class UserActivity extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ name: 'activity_type', type: 'enum', enum: ActivityType })
  activityType!: ActivityType;

  @Column({ name: 'segment_uuid', type: 'varchar', nullable: true })
  segmentUuid?: string | null;

  @Column({ name: 'media_id', type: 'int', nullable: true })
  mediaId?: number | null;

  @Column({ name: 'search_query', type: 'varchar', nullable: true })
  searchQuery?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
