import { Entity, PrimaryColumn, Column } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity('MediaAuditRun')
export class MediaAuditRun extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'audit_name', type: 'varchar' })
  auditName!: string;

  @Column({ type: 'varchar', nullable: true })
  category?: string | null;

  @Column({ name: 'result_count', type: 'int' })
  resultCount!: number;

  @Column({ name: 'threshold_used', type: 'jsonb' })
  thresholdUsed!: Record<string, number | boolean>;
}
