import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { User } from './User';
import { BaseEntity } from './base.entity';

export enum RoadmapItemKind {
  CONTENT = 'CONTENT',
  FEATURE = 'FEATURE',
}

export enum RoadmapItemStatus {
  PROPOSED = 'PROPOSED',
  CONSIDERING = 'CONSIDERING',
  PLANNED = 'PLANNED',
  IN_PROGRESS = 'IN_PROGRESS',
  RELEASED = 'RELEASED',
  DECLINED = 'DECLINED',
}

@Entity('RoadmapItem')
@Index(['status', 'sortOrder'])
export class RoadmapItem extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'public_id', type: 'uuid', unique: true, generated: 'uuid' })
  publicId!: string;

  @Column({ type: 'enum', enum: RoadmapItemKind })
  kind!: RoadmapItemKind;

  @Column({ type: 'enum', enum: RoadmapItemStatus, default: RoadmapItemStatus.PROPOSED })
  status!: RoadmapItemStatus;

  @Column({ type: 'varchar', length: 180 })
  title!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  @Column({ name: 'source_url', type: 'text', nullable: true })
  sourceUrl?: string | null;

  @Column({ name: 'cover_url', type: 'text', nullable: true })
  coverUrl?: string | null;

  @Column({ name: 'target_date', type: 'date', nullable: true })
  targetDate?: string | null;

  @Column({ name: 'introduced_in_version', type: 'varchar', length: 32, nullable: true })
  introducedInVersion?: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ name: 'requester_user_id', type: 'int', nullable: true })
  requesterUserId?: number | null;

  @Column({ name: 'proposer_name', type: 'varchar', length: 80, nullable: true })
  proposerName?: string | null;

  @ManyToOne('User', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'requester_user_id' })
  requester?: User | null;

  toJSON(includePrivate = false) {
    return {
      id: this.publicId,
      kind: this.kind,
      status: this.status,
      title: this.title,
      description: this.description,
      sourceUrl: this.sourceUrl ?? null,
      coverUrl: this.coverUrl ?? null,
      targetDate: this.targetDate ?? null,
      introducedInVersion: this.introducedInVersion ?? null,
      sortOrder: this.sortOrder,
      createdAt: this.createdAt.toISOString(),
      proposerName: this.proposerName ?? null,
      ...(includePrivate ? { requesterUserId: this.requesterUserId ?? null } : {}),
    };
  }
}
