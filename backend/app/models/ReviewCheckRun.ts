import { Entity, PrimaryColumn, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('ReviewCheckRun')
export class ReviewCheckRun extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'check_name', type: 'varchar' })
  checkName!: string;

  @Column({ type: 'varchar', nullable: true })
  category?: string | null;

  @Column({ name: 'result_count', type: 'int' })
  resultCount!: number;

  @Column({ name: 'threshold_used', type: 'jsonb' })
  thresholdUsed!: Record<string, number | boolean>;
}
