import { Entity, PrimaryColumn, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('ReviewAllowlist')
@Index(['checkName', 'mediaId', 'episodeNumber'], { unique: true })
export class ReviewAllowlist extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'check_name', type: 'varchar' })
  checkName!: string;

  @Column({ name: 'media_id', type: 'int' })
  mediaId!: number;

  @Column({ name: 'episode_number', type: 'int', nullable: true })
  episodeNumber?: number | null;

  @Column({ type: 'varchar', nullable: true })
  reason?: string | null;
}
