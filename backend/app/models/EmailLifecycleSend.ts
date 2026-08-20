import { Entity, PrimaryColumn, Column, Index } from 'typeorm';
import type { EmailKind } from '@app/services/email/metrics';
import { BaseEntity } from './base.entity';

/**
 * The kinds of lifecycle mail the nightly sweep can send.
 *
 * A separate union from `EmailKind`, which names every message the app can
 * send at all -- transactional mail is not swept, has nothing to dedupe, and
 * must never be gated on a preference. Keeping the two apart means a new
 * transactional message cannot accidentally become something the sweep tries to
 * schedule.
 */
export const LIFECYCLE_KINDS = ['onboarding-day7', 'feedback-ask', 'recap'] as const satisfies readonly EmailKind[];

export type LifecycleKind = (typeof LIFECYCLE_KINDS)[number];

/**
 * What we have already sent, so a sweep that runs twice does not send twice.
 * See the migration for why this is a table and why the row is written at
 * enqueue rather than after delivery.
 */
@Entity('EmailLifecycleSend')
@Index(['userId', 'kind', 'campaign'], { unique: true })
export class EmailLifecycleSend extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ type: 'varchar', length: 32 })
  kind!: LifecycleKind;

  /**
   * Which run of this kind. `onboarding-day7` and `feedback-ask` happen once per
   * account and repeat the kind here; `recap` carries the period it covers
   * (`recap-2026-08`), which is what lets a monthly email recur without any run
   * being repeatable.
   */
  @Column({ type: 'varchar', length: 64 })
  campaign!: string;

  @Column({ name: 'sent_at', type: 'timestamptz' })
  sentAt!: Date;
}
