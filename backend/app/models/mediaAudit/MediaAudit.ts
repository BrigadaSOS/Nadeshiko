import { Entity, PrimaryColumn, Column } from 'typeorm';
import { BaseEntity } from '../base.entity';

export enum MediaAuditTargetType {
  MEDIA = 'MEDIA',
  EPISODE = 'EPISODE',
}

@Entity('MediaAudit')
export class MediaAudit extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ type: 'varchar', unique: true })
  name!: string;

  @Column({ type: 'varchar' })
  label!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ name: 'target_type', type: 'enum', enum: MediaAuditTargetType })
  targetType!: MediaAuditTargetType;

  @Column({ type: 'jsonb' })
  threshold!: Record<string, number | boolean>;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;
}
