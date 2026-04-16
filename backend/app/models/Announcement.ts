import { Entity, PrimaryColumn, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

export type AnnouncementType = 'INFO' | 'WARNING' | 'MAINTENANCE';

@Entity('Announcement')
export class Announcement extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'varchar', length: 20, default: 'INFO' })
  type!: AnnouncementType;

  @Column({ type: 'boolean', default: false })
  active!: boolean;
}
