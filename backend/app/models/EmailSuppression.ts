import { Entity, PrimaryColumn, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/** Suppress by address, not `User`, because a bounced magic-link address may have no account yet. */
@Entity('EmailSuppression')
export class EmailSuppression extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 320 })
  address!: string;

  @Column({ type: 'varchar', length: 32 })
  cause!: SuppressionCause;

  /** The provider's own words, kept so a lift decision has something to read. */
  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  @Column({ name: 'suppressed_at', type: 'timestamptz' })
  suppressedAt!: Date;
}

/** Record manual and repeated-soft-bounce causes separately so operators know whether a human or provider history
 * caused suppression. */
export const SUPPRESSION_CAUSES = ['hard_bounce', 'complaint', 'repeated_soft_bounce', 'manual'] as const;

export type SuppressionCause = (typeof SUPPRESSION_CAUSES)[number];

/** Never lift complaint suppression automatically; another send can turn one spam report into a blocked domain. */
export function isPermanentCause(cause: SuppressionCause): boolean {
  return cause === 'complaint';
}
