import { Entity, PrimaryColumn, Column, CreateDateColumn, Index, BaseEntity as TypeOrmBaseEntity } from 'typeorm';

@Entity('ReviewAllowlist')
@Index(['checkName', 'mediaId', 'episodeNumber'], { unique: true })
export class ReviewAllowlist extends TypeOrmBaseEntity {
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

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
