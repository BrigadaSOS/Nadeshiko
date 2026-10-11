import { Entity, PrimaryColumn, Column, Index } from 'typeorm';
import type { EmailKind } from '@app/services/email/metrics';
import { BaseEntity } from './base.entity';

/** Keep lifecycle kinds separate from all `EmailKind` values so transactional mail is never swept or
 * preference-gated. */
export const LIFECYCLE_KINDS = ['feedback-ask', 'dormant-30', 'recap'] as const satisfies readonly EmailKind[];

export type LifecycleKind = (typeof LIFECYCLE_KINDS)[number];

/** Write the dedupe claim at enqueue time so a repeated sweep cannot enqueue the same lifecycle mail twice. */
@Entity('EmailLifecycleSend')
@Index(['userId', 'kind', 'campaign'], { unique: true })
export class EmailLifecycleSend extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ type: 'varchar', length: 32 })
  kind!: LifecycleKind;

  /** Use campaign values for recurring dormancy; the unique key must allow a later lapse after the reader returns
   * without making a nag. */
  @Column({ type: 'varchar', length: 64 })
  campaign!: string;

  @Column({ name: 'sent_at', type: 'timestamptz' })
  sentAt!: Date;
}
