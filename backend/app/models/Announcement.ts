import { Entity, PrimaryColumn, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

export type AnnouncementType = 'info' | 'warning' | 'maintenance';

@Entity('Announcement')
export class Announcement extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'varchar', length: 20, default: 'info' })
  type!: AnnouncementType;

  @Column({ type: 'boolean', default: false })
  active!: boolean;
}
