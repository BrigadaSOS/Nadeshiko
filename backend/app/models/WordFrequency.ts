import { Entity, PrimaryColumn, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('WordFrequency')
export class WordFrequency extends BaseEntity {
  @PrimaryColumn({ type: 'int' })
  rank!: number;

  @Column({ type: 'varchar', length: 50 })
  word!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  reading!: string | null;

  @Column({ name: 'match_count', type: 'int', default: 0 })
  matchCount!: number;
}
