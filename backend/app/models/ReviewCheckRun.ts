import { Entity, PrimaryColumn, Column, CreateDateColumn, BaseEntity as TypeOrmBaseEntity } from 'typeorm';

@Entity('ReviewCheckRun')
export class ReviewCheckRun extends TypeOrmBaseEntity {
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

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
